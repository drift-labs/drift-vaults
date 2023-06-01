"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VaultClient = void 0;
const sdk_1 = require("@drift-labs/sdk");
const name_1 = require("./name");
const addresses_1 = require("./addresses");
class VaultClient {
    constructor({ driftClient, program, }) {
        this.driftClient = driftClient;
        this.program = program;
    }
    async initializeVault(name) {
        const encodedName = name_1.encodeName(name);
        const vault = addresses_1.getVaultAddressSync(this.program.programId, encodedName);
        const driftState = await this.driftClient.getStatePublicKey();
        const userStatsKey = await sdk_1.getUserStatsAccountPublicKey(this.driftClient.program.programId, vault);
        const userKey = await sdk_1.getUserAccountPublicKeySync(this.driftClient.program.programId, vault);
        return await this.program.methods
            .initializeVault(encodedName)
            .accounts({
            driftUserStats: userStatsKey,
            driftUser: userKey,
            driftState,
            vault,
            driftProgram: this.driftClient.program.programId,
        })
            .rpc();
    }
}
exports.VaultClient = VaultClient;
