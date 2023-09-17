const { Keypair, Connection, Transaction, PublicKey,
    sendAndConfirmTransaction,
    SystemProgram,
    Wallet
} = require('@solana/web3.js');
const {
    createTransferInstruction,
    getOrCreateAssociatedTokenAccount,
    TOKEN_PROGRAM_ID, } = require('@solana/spl-token')
const bs58 = require('bs58');
const fetch = require('node-fetch');
const fs = require('fs');
const delay = require('delay');
require('dotenv').config()

const rpcUrl = process.env.RPC_URL;
const connection = new Connection(rpcUrl, 'max');

const tokenAddress = process.env.TOKEN_ADDRESS;
const tokenSymbol = process.env.TOKEN_SYMBOL;

const checkToken = (payload) => new Promise((resolve, reject) => {
    fetch('https://api.mainnet-beta.solana.com', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    })
        .then(res => res.json())
        .then(res => resolve(res))
        .catch(err => reject(err))
});

function solToLamports(solAmount) {
    const lamportsPerSol = 1000000000; // 1 SOL = 1.000.000.000 lamports
    return Math.floor(solAmount * lamportsPerSol);
}

const transferFromPrivateKeyToMainWallet = async (senderPrivateKey, walletReceiver, amount) => {
    const fromWallet = senderPrivateKey;
    const transaction = new Transaction().add(SystemProgram.transfer({
        fromPubkey: fromWallet.publicKey,
        toPubkey: walletReceiver,
        lamports: amount
    }));

    // ensure the transaction is recent using the latest blockhash
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    // sign transaction
    transaction.sign(fromWallet);

    // send and confirm transaction
    return sendAndConfirmTransaction(connection, transaction, [fromWallet]);
};

const getTransactionFee = async (masterWallet, testWallet, amount) => {
    const recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    const transaction = new Transaction();

    transaction.recentBlockhash = recentBlockhash;
    transaction.feePayer = masterWallet

    transaction.add(SystemProgram.transfer({
        fromPubkey: masterWallet,
        toPubkey: testWallet,
        lamports: 10
    }));

    const message = transaction.compileMessage();
    const response = await connection.getFeeForMessage(
        message,
        'confirmed'
    );
    const feeInLamports = response.value;
    return feeInLamports;
};

const transferToken = async (privateKeyTokenHolding, mainWallet, amount) => {
    const uint8ArraySecretKeyHolding = bs58.decode(privateKeyTokenHolding);
    const fromWalletKeypair = Keypair.fromSecretKey(uint8ArraySecretKeyHolding);

    const toWalletAddress = mainWallet;
    const toWalletPublicKey = new PublicKey(toWalletAddress);

    const mintPublicKey = new PublicKey(tokenAddress);

    // Definisikan fungsi getOrCreateAssociatedTokenAccount jika belum ada
    // Definisikan TOKEN_PROGRAM_ID jika belum ada

    const fromTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        fromWalletKeypair,
        mintPublicKey,
        fromWalletKeypair.publicKey
    );

    const toTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        fromWalletKeypair,
        mintPublicKey,
        toWalletPublicKey
    );

    const instructions = [];
    instructions.push(
        createTransferInstruction(
            fromTokenAccount.address,
            toTokenAccount.address,
            fromWalletKeypair.publicKey,
            amount,
            TOKEN_PROGRAM_ID,
        ),
    );

    const transaction = new Transaction().add(...instructions);
    transaction.feePayer = fromWalletKeypair.publicKey;

    return await sendAndConfirmTransaction(connection, transaction, [
        fromWalletKeypair,
    ]);
}

const getBalances = async (address) => {
    const balance = await connection.getBalance(new PublicKey(address));

    return balance;
}

(async () => {

    // configuration
    const feeForSendToken = process.env.FEE_FOR_SEND_TOKEN;

    // private key for sending fee
    const privateKeyUtama = process.env.MAIN_PRIVATE_KEY;


    const uint8ArraySecretKeyUtama = bs58.decode(privateKeyUtama);
    const walletKeypairUtama = Keypair.fromSecretKey(uint8ArraySecretKeyUtama);

    const listPrivateKey = fs.readFileSync('./privateKey.txt', 'utf-8').split('\n');
    console.log(`Solana Token Collector....`)
    console.log('')
    let payload = []
    for (let index = 0; index < listPrivateKey.length; index++) {
        const privateKey = listPrivateKey[index];
        if (privateKey) {
            const uint8ArraySecretKey = bs58.decode(privateKey);
            const walletKeypair = Keypair.fromSecretKey(uint8ArraySecretKey);
            const publicKeyAddress = walletKeypair.publicKey.toBase58();
            payload.push({
                address: publicKeyAddress,
                privateKey,
                "jsonrpc": "2.0",
                "id": 1,
                "method": "getTokenAccountsByOwner",
                "params": [
                    publicKeyAddress,
                    {
                        "mint": tokenAddress
                    },
                    {
                        "encoding": "jsonParsed"
                    }
                ]
            });
            if (payload.length === 30) {
                const newPayload = payload;
                const payloadModification = payload.map(({ privateKey, address, ...keepAttrs }) => keepAttrs);
                const resultAllToken = await checkToken(payloadModification);
                for (let index = 0; index < resultAllToken.length; index++) {
                    const element = resultAllToken[index];
                    const dataReal = newPayload[index];
                    if (element.result.value.length > 0) {
                        if (element.result.value[0].account.data.parsed.info.tokenAmount.uiAmount > 0) {
                            console.log(`Address : ${dataReal.address}`);
                            console.log(`$${tokenSymbol} Found : ${element.result.value[0].account.data.parsed.info.tokenAmount.uiAmount}`)
                            console.log(`Try sending fee....`)
                            const solToLamportsResults = solToLamports(feeForSendToken);
                            const transferResult = await transferFromPrivateKeyToMainWallet(walletKeypairUtama,
                                new PublicKey(dataReal.address), solToLamportsResults);
                            if (transferResult) {
                                const totalTokenHave = element.result.value[0].account.data.parsed.info.tokenAmount.uiAmount;
                                console.log(`Success transfer fee... trying to send ${totalTokenHave} $${tokenSymbol} to main wallet...`);
                                const tokenAmount = solToLamports(totalTokenHave);
                                const resultTokenTransfer = await transferToken(dataReal.privateKey, walletKeypairUtama.publicKey.toBase58(), tokenAmount);
                                if (resultTokenTransfer) {
                                    console.log(`Success transfering ${tokenSymbol.toLowerCase()} to main wallet!`)
                                    console.log(`Transfering remaining balance to main wallet!`);
                                    const transactionFee = await getTransactionFee(walletKeypairUtama.publicKey, new PublicKey(dataReal.address))
                                    const balance = await getBalances(dataReal.address);
                                    const transferAmount = balance - transactionFee;

                                    const uint8ArraySecretKey = bs58.decode(dataReal.privateKey);
                                    const walletKeypair = Keypair.fromSecretKey(uint8ArraySecretKey);
                                    const transferResult = await transferFromPrivateKeyToMainWallet(walletKeypair, walletKeypairUtama.publicKey, transferAmount);
                                    if (transferResult) {
                                        console.log(`Success transfer to main Account!`);
                                        console.log('')
                                    }
                                }
                            }


                        }

                    }

                }

                payload = [];
                await delay(5000);
            }



        }
    }



})()
