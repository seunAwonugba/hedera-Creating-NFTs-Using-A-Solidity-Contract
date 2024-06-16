const dotenv = require("dotenv");
dotenv.config();
const {
    Client,
    Hbar,
    ContractCreateFlow,
    ContractExecuteTransaction,
    ContractFunctionParameters,
    AccountId,
    PrivateKey,
    AccountCreateTransaction,
} = require("@hashgraph/sdk");
const fs = require("fs");
const { metadata } = require("./constant");
const { HEDERA_ACCOUNT_ID, HEDERA_PRIVATE_KEY } = process.env;

async function createDeployTransferNFT() {
    if (!HEDERA_ACCOUNT_ID || !HEDERA_PRIVATE_KEY) {
        throw new Error("Invalid hedera credentials");
    }

    //Create your Hedera Testnet client
    const client = Client.forTestnet();

    client.setOperator(HEDERA_ACCOUNT_ID, HEDERA_PRIVATE_KEY);

    client.setDefaultMaxTransactionFee(new Hbar(100));

    client.setDefaultMaxQueryPayment(new Hbar(50));

    const newAccountPrivateKey = PrivateKey.generateED25519();
    const newAccountPublicKey = newAccountPrivateKey.publicKey;

    //Create a new account with 1,000 tinybar starting balance
    const newAccount = await new AccountCreateTransaction()
        .setInitialBalance(new Hbar(100))
        .setKey(newAccountPublicKey)
        .setInitialBalance(Hbar.fromTinybars(1000))
        .setMaxAutomaticTokenAssociations(10)
        .execute(client);

    // Get the new account ID
    const getReceipt = await newAccount.getReceipt(client);
    const newAccountId = getReceipt.accountId;

    //Log the account ID
    console.log("The new account ID is: " + newAccountId);

    const bytecode = fs.readFileSync("./NFTCreator_sol_NFTCreator.bin");

    // Create contract
    const createContract = new ContractCreateFlow()
        .setGas(4000000) // Increase if revert
        .setBytecode(bytecode); // Contract bytecode
    const createContractTx = await createContract.execute(client);
    const createContractRx = await createContractTx.getReceipt(client);
    const contractId = createContractRx.contractId;

    console.log(`Contract created with ID: ${contractId} \n`);

    // Create NFT from precompile
    const createToken = new ContractExecuteTransaction()
        .setContractId(contractId)
        .setGas(4000000) // Increase if revert
        .setPayableAmount(50) // Increase if revert
        .setFunction(
            "createNft",
            new ContractFunctionParameters()
                .addString("Fall Collection") // NFT name
                .addString("LEAF") // NFT symbol
                .addString("Just a memo") // NFT memo
                .addInt64(250) // NFT max supply
                .addInt64(7000000) // Expiration: Needs to be between 6999999 and 8000001
        );
    const createTokenTx = await createToken.execute(client);
    const createTokenRx = await createTokenTx.getRecord(client);
    const tokenIdSolidityAddr =
        createTokenRx.contractFunctionResult.getAddress(0);
    const tokenId = AccountId.fromSolidityAddress(tokenIdSolidityAddr);

    console.log(`Token created with ID: ${tokenId} \n`);

    // Mint NFT
    const mintToken = new ContractExecuteTransaction()
        .setContractId(contractId)
        .setGas(4000000)
        .setMaxTransactionFee(new Hbar(20)) //Use when HBAR is under 10 cents
        .setFunction(
            "mintNft",
            new ContractFunctionParameters()
                .addAddress(tokenIdSolidityAddr) // Token address
                .addBytesArray([Buffer.from(metadata)]) // Metadata
        );

    const mintTokenTx = await mintToken.execute(client);
    const mintTokenRx = await mintTokenTx.getRecord(client);
    const serial = mintTokenRx.contractFunctionResult.getInt64(0);

    console.log(`Minted NFT with serial: ${serial} \n`);

    // Transfer NFT to new account
    const transferToken = await new ContractExecuteTransaction()
        .setContractId(contractId)
        .setGas(4000000)
        .setFunction(
            "transferNft",
            new ContractFunctionParameters()
                .addAddress(tokenIdSolidityAddr) // Token address
                .addAddress(newAccountId.toSolidityAddress()) // Token receiver new account
                .addInt64(serial)
        ) // NFT serial number
        .freezeWith(client) // freezing using client
        .sign(newAccountPrivateKey); // Sign transaction with

    const transferTokenTx = await transferToken.execute(client);
    const transferTokenRx = await transferTokenTx.getReceipt(client);

    console.log(`Transfer status: ${transferTokenRx.status} \n`);
}

createDeployTransferNFT();
