use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{transfer, Mint, Token, TokenAccount, Transfer},
};
use constant_product_curve::{ConstantProduct, LiquidityPair};

use crate::{errors::AmmError, state::Config};

#[derive(Accounts)]
pub struct Swap<'info> {
    // TODO: Write the accounts struct
    #[account(mut)]
    pub swaper: Signer<'info>,
    pub mint_x: Account<'info, Mint>,
    pub mint_y: Account<'info, Mint>,
    #[account(
        has_one = mint_x,
        has_one = mint_y,
        seeds = [b"config", config.seed.to_le_bytes().as_ref()],
        bump = config.config_bump,
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"lp", config.key().as_ref()],
        bump = config.lp_bump,
    )]
    pub mint_lp: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint_x,
        associated_token::authority = config,
    )]
    pub vault_x: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = mint_y,
        associated_token::authority = config,
    )]
    pub vault_y: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = mint_x,
        associated_token::authority = swaper,
    )]
    pub swapper_x: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = mint_y,
        associated_token::authority = swaper,
    )]
    pub swapper_y: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

impl<'info> Swap<'info> {
    pub fn swap(&mut self, is_x: bool, amount: u64, min: u64) -> Result<()> {
        require!(self.config.locked == false, AmmError::PoolLocked);
        require!(amount != 0, AmmError::InvalidAmount);

        let pair = match is_x {
            true => LiquidityPair::X,

            false => LiquidityPair::Y,
        };

        let mut curve = ConstantProduct::init(
            self.vault_x.amount,
            self.vault_y.amount,
            self.mint_lp.supply,
            self.config.fee,
            Some(6),
        )
        .unwrap();

        let result = curve
            .swap(pair, amount, min)
            .map_err(|_| AmmError::SlippageExceeded)?;

        let deposit_amount = result.deposit;

        let withdraw_amount = result.withdraw;

        self.deposit_tokens(is_x, deposit_amount)?;

        self.withdraw_tokens(!is_x, withdraw_amount)?;
        
        Ok(())
    }

    pub fn deposit_tokens(&mut self, is_x: bool, amount: u64) -> Result<()> {
        let (from, to) = match is_x {
            true => (
                self.swapper_x.to_account_info(),
                self.vault_x.to_account_info(),
            ),
            false => (
                self.swapper_y.to_account_info(),
                self.vault_y.to_account_info(),
            ),
        };

        let cpi_programs = self.token_program.to_account_info();

        let cpi_accounts = Transfer {
            from,
            to,
            authority: self.swaper.to_account_info(),
        };

        let ctx = CpiContext::new(cpi_programs, cpi_accounts);

        transfer(ctx, amount)?;

        Ok(())
    }

    pub fn withdraw_tokens(&mut self, is_x: bool, amount: u64) -> Result<()> {
        let (from, to) = match is_x {
            true => (
                self.vault_x.to_account_info(),
                self.swapper_x.to_account_info(),
            ),
            false => (
                self.vault_y.to_account_info(),
                self.swapper_y.to_account_info(),
            ),
        };
        let cpi_programs = self.token_program.to_account_info();

        let cpi_accounts = Transfer {
            from,
            to,
            authority: self.config.to_account_info(),
        };

        let signer_seeds: &[&[&[u8]]] = &[&[
            b"config",
            &self.config.seed.to_le_bytes(),
            &[self.config.config_bump],
        ]];
        let ctx = CpiContext::new_with_signer(cpi_programs, cpi_accounts, signer_seeds);

        transfer(ctx, amount)?;

        Ok(())
    }
}
