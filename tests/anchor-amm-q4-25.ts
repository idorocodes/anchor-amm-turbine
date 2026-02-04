import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorAmmQ425 } from "../target/types/anchor_amm_q4_25";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createMint,
  getAssociatedTokenAddressSync,
  mintTo,
  TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";

describe("turbine amm test", async () => {
  const provider = anchor.AnchorProvider.env();

  anchor.setProvider(provider);

  const program = anchor.workspace.anchorAmmQ425 as Program<AnchorAmmQ425>;

  const initializer = provider.wallet.publicKey;

  const depositor = anchor.web3.Keypair.generate();
  const seed = new anchor.BN(20395);

  let mintX: anchor.web3.PublicKey;
  let mintY: anchor.web3.PublicKey;
  let depositorAtaX: anchor.web3.PublicKey;
  let depositorAtaY: anchor.web3.PublicKey;
  let vaultX: anchor.web3.PublicKey;
  let vaultY: anchor.web3.PublicKey;
  let mintLp: anchor.web3.PublicKey;
  let mintLpBump: number;
  let vaultPda: anchor.web3.PublicKey;
  let configBump: number;

  let amount = 4000;

  let depositorMintLPATA: anchor.web3.PublicKey;

  before(async () => {
    await provider.connection.requestAirdrop(
      initializer,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );

    await provider.connection.requestAirdrop(
      depositor.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );

    await new Promise((resolve) => setTimeout(resolve, 1000));

    [vaultPda, configBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config"), seed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    [mintLp, mintLpBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("lp"), vaultPda.toBuffer()],
      program.programId
    );

    depositorMintLPATA = getAssociatedTokenAddressSync(
      mintLp,
      depositor.publicKey,
      true
    );

    mintX = await createMint(
      provider.connection,
      provider.wallet.payer,
      provider.wallet.publicKey,
      null,
      6
    );

    mintY = await createMint(
      provider.connection,
      provider.wallet.payer,
      provider.wallet.publicKey,
      null,
      6
    );

    vaultX = getAssociatedTokenAddressSync(mintX, vaultPda, true);
    vaultY = getAssociatedTokenAddressSync(mintY, vaultPda, true);

    depositorAtaX = getAssociatedTokenAddressSync(
      mintX,
      depositor.publicKey,
      true
    );

    const depositorAtaXTx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        provider.wallet.publicKey,
        depositorAtaX,
        depositor.publicKey,
        mintX
      )
    );

    await provider.sendAndConfirm(depositorAtaXTx);
    await mintTo(
      provider.connection,
      provider.wallet.payer,
      mintX,
      depositorAtaX,
      provider.wallet.payer,
      BigInt(amount) * BigInt(10 ** 6)
    );
    depositorAtaY = getAssociatedTokenAddressSync(
      mintY,
      depositor.publicKey,
      true
    );

    const depositorAtaYTx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        provider.wallet.publicKey,
        depositorAtaY,
        depositor.publicKey,
        mintY
      )
    );

    await provider.sendAndConfirm(depositorAtaYTx);
    await mintTo(
      provider.connection,
      provider.wallet.payer,
      mintY,
      depositorAtaY,
      provider.wallet.payer,
      BigInt(amount) * BigInt(10 ** 6)
    );
  });

  it("intialize amm protocol", async () => {
    const tx = await program.methods
      .initialize(seed, 100, initializer)
      .accountsStrict({
        initializer: initializer,
        mintX: mintX,
        mintY: mintY,
        mintLp: mintLp,
        vaultX: vaultX,
        vaultY: vaultY,
        config: vaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log("Your transaction signature", tx);

    const fetchAccount = await program.account.config.fetch(vaultPda);

    expect(fetchAccount.authority.toBase58()).equal(initializer.toBase58());
    expect(fetchAccount.mintX.toBase58()).equal(mintX.toBase58());
    expect(fetchAccount.mintY.toBase58()).equal(mintY.toBase58());
    expect(fetchAccount.fee).equal(100);
  });

  it("deposit into amm", async () => {
    const tx = await program.methods
      .deposit(
        new anchor.BN(10 * 10 ** 6),
        new anchor.BN(100 * 10 ** 6),
        new anchor.BN(100 * 10 ** 6)
      )
      .accountsStrict({
        user: depositor.publicKey,
        mintX: mintX,
        mintY: mintY,
        config: vaultPda,
        mintLp: mintLp,
        vaultX: vaultX,
        vaultY: vaultY,
        userX: depositorAtaX,
        userY: depositorAtaY,
        userLp: depositorMintLPATA,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([depositor])
      .rpc();
    console.log("Your transaction signature", tx);

    const depositorMintLPATAAccount = await getAccount(
      provider.connection,
      depositorMintLPATA
    );

    expect(depositorMintLPATAAccount.amount).to.equal(
      BigInt(10) * BigInt(10 ** 6)
    );
  });

  it("withdraw into amm", async () => {
    const tx = await program.methods
      .withdraw(
        new anchor.BN(5 * 10 ** 6),
        new anchor.BN(1 * 10 ** 6),
        new anchor.BN(1 * 10 ** 6)
      )
      .accountsStrict({
        user: depositor.publicKey,
        mintX: mintX,
        mintY: mintY,
        config: vaultPda,
        mintLp: mintLp,
        vaultX: vaultX,
        vaultY: vaultY,
        userX: depositorAtaX,
        userY: depositorAtaY,
        userLp: depositorMintLPATA,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([depositor])
      .rpc();
    console.log("Your transaction signature", tx);

    const depositorMintLpToken = await getAccount(
      provider.connection,
      depositorMintLPATA
    );

    expect(depositorMintLpToken.amount).to.equal(BigInt(5) * BigInt(10 ** 6));
  });

  it("swap", async () => {
    const formerTokenXDepositor = (
      await getAccount(provider.connection, depositorAtaX)
    ).amount;
    const formerTokenYDepositor = (
      await getAccount(provider.connection, depositorAtaY)
    ).amount;

    const tx = await program.methods
      .swap(true, new anchor.BN(5 * 10 ** 6), new anchor.BN(1 * 10 ** 6))
      .accountsStrict({
        swaper: depositor.publicKey,
        mintX: mintX,
        mintY: mintY,
        config: vaultPda,
        mintLp: mintLp,
        vaultX: vaultX,
        vaultY: vaultY,
        swapperX: depositorAtaX,
        swapperY: depositorAtaY,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([depositor])
      .rpc();
    console.log("Your transaction signature", tx);

    const newTokenXDepositor = (
      await getAccount(provider.connection, depositorAtaX)
    ).amount;
    const newTokenYDepositor = (
      await getAccount(provider.connection, depositorAtaY)
    ).amount;

    expect(Number(newTokenYDepositor)).greaterThan(
      Number(formerTokenYDepositor)
    );
    expect(Number(newTokenXDepositor)).lessThan(Number(formerTokenXDepositor));
  });
});
