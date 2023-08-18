import {
    initVault,
    viewVault,
    managerDeposit,
    managerWithdraw,
    applyProfitShare,
    initVaultDepositor,
    deposit,
    requestWithdraw,
    withdraw,
} from "./commands";

import { Command, Option } from 'commander';
import { viewVaultDepositor } from "./commands/viewVaultDepositor";
require('dotenv').config();

const program = new Command();
program
    .addOption(new Option("-r, --rpc <url>", "RPC URL to use").env("RPC_URL").makeOptionMandatory(true))
    .addOption(new Option("-k, --keypair <fiilepath>", "Path to keypair file").env("KEYPAIR_PATH"))
    .addOption(new Option("--commitment <commitment>", "State commitment to use").default("confirmed"));
program
    .command("init")
    .description("Initialize a new vault")
    .option("-n, --name <vaultName>", "Name of the vault to create", "my new vault")
    .action((opts) => initVault(program, opts));
program
    .command("view-vault")
    .description("View Vault account details")
    .addOption(new Option("--vault-address <address>", "Address of the Vault to view").makeOptionMandatory(true))
    .action((opts) => viewVault(program, opts));
program
    .command("view-vault-depositor")
    .description("View VaultDepositor account details")
    .addOption(new Option("--vault-depositor-address <address>", "Address of the VaultDepositor to view").makeOptionMandatory(true))
    .action((opts) => viewVaultDepositor(program, opts));
program
    .command("manager-deposit")
    .description("Make a deposit to your vault")
    .addOption(new Option("--vault-address <address>", "Address of the vault to view").makeOptionMandatory(true))
    .addOption(new Option("--amount <amount>", "Amount to deposit (human format, 5 for 5 USDC)").makeOptionMandatory(true))
    .action((opts) => managerDeposit(program, opts));
program
    .command("manager-withdraw")
    .description("Make a deposit to your vault")
    .addOption(new Option("--vault-address <address>", "Address of the vault to view").makeOptionMandatory(true))
    .addOption(new Option("--shares <shares>", "Amount of shares to withdraw (raw precision, as expected by contract)").makeOptionMandatory(true))
    .action((opts) => managerWithdraw(program, opts));
program
    .command("apply-profit-share-all")
    .description("Turn the profit share crank for all depositors")
    .addOption(new Option("--vault-address <address>", "Address of the vault to view").makeOptionMandatory(true))
    .action((opts) => applyProfitShare(program, opts));
program
    .command("init-vault-depositor")
    .description("Initialize a VaultDepositor for someone to deposit into your vault")
    .addOption(new Option("--vault-address <address>", "Address of the vault to create a VaultDepositor for").makeOptionMandatory(true))
    .addOption(new Option("--deposit-authority <depositAuthority>", "Authority to create the VaultDepositor for, only they can deposit in the vault.").makeOptionMandatory(true))
    .action((opts) => initVaultDepositor(program, opts));
program
    .command("deposit")
    .description("Deposit into a vault via VaultDepositor")
    .addOption(new Option("--vault-depositor-address <vaultDepositorAddress>", "VaultDepositor address").makeOptionMandatory(true))
    .addOption(new Option("--amount <amount>", "Amount to deposit (human format, 5 for 5 USDC)").makeOptionMandatory(true))
    .action((opts) => deposit(program, opts));
program
    .command("request-withdraw")
    .description("Make a request to withdraw shares from the vaultm, redeem period starts now")
    .addOption(new Option("--vault-depositor-address <vaultDepositorAddress>", "VaultDepositor address").makeOptionMandatory(true))
    .addOption(new Option("--amount <amount>", "Amount of shares to withdraw (raw format, as expected in the program)").makeOptionMandatory(true))
    .action((opts) => requestWithdraw(program, opts));
program
    .command("withdraw")
    .description("Initiate the withdraw, after the redeem period has passed")
    .addOption(new Option("--vault-depositor-address <vaultDepositorAddress>", "VaultDepositor address").makeOptionMandatory(true))
    .action((opts) => withdraw(program, opts));

program.parseAsync().then(() => {});
