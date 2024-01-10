import Solana from '@ledgerhq/hw-app-solana';
import type { default as Transport } from '@ledgerhq/hw-transport';
import TransportNodeHid from '@ledgerhq/hw-transport-node-hid';
import { getDevices } from '@ledgerhq/hw-transport-node-hid-noevents';
import { LedgerWalletAdapter, getDerivationPath } from '@solana/wallet-adapter-ledger';
import { PublicKey } from '@solana/web3.js';

// https://docs.solana.com/wallet-guide/hardware-wallets#specify-a-keypair-url
// usb://<MANUFACTURER>[/<WALLET_ID>][?key=<ACCOUNT>[/<CHANGE>]]
export const parseKeypairUrl = (url = ''): {
  walletId?: string,
  account?: number,
  change?: number,
} => {
  const walletId = url.match(/(?<=usb:\/\/ledger\/)(\w+)?/)?.[0];
  const [account, change] = (url.split('?key=')[1]?.split('/') ?? []).map(
    Number
  );
  return {
    walletId,
    account,
    change,
  };
};


async function getPublicKey(
  transport: Transport,
  account?: number,
  change?: number
): Promise<PublicKey> {
  const path =
    "44'/501'" +
    (account !== undefined ? `/${account}` : '') +
    (change !== undefined ? `/${change}` : '');

  let { address } = await new Solana(transport).getAddress(path);
  return new PublicKey(new Uint8Array(address));
}

// Fix class type
interface Wallet extends LedgerWalletAdapter {
  publicKey: PublicKey;
}

export async function getLedgerWallet(url = ''): Promise<Wallet> {
  const { account, change, walletId } = parseKeypairUrl(url);

  const derivationPath = getDerivationPath(account, change);

  let transport = await TransportNodeHid.open('');

  let publicKey = await getPublicKey(transport, account, change);

  // If walletId is specified, we need to find the correct device.
  if (walletId) {
    const devices = getDevices();
    for (let device of devices) {
      if (publicKey.toString() === walletId) {
        // Correct device found.
        break;
      }
      transport.close(); // Close the previous transport
      // Open new device and see if it matches wallet
      transport = await TransportNodeHid.open(device.path);
      publicKey = await getPublicKey(transport, account, change);
    }

    if (publicKey.toString() !== walletId) {
      throw new Error('Wallet not found');
    }
  }

  const wallet = new LedgerWalletAdapter({ derivationPath });
  // Ledger wallet adapter assumes web interface
  // Inject our own transport and public key
  wallet['_transport'] = transport;
  wallet['_publicKey'] = publicKey;

  // Hook up things done on connect
  transport.on('disconnect', wallet['_disconnected']);
  wallet.emit('connect', publicKey);

  return wallet as Wallet;
}
