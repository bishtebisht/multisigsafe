import * as StellarSdk from '@stellar/stellar-sdk'
import { isConnected, requestAccess, signTransaction } from '@stellar/freighter-api'

const CONTRACT_ID = (import.meta.env.VITE_CONTRACT_ID       || '').trim()
const XLM_TOKEN   = (import.meta.env.VITE_XLM_TOKEN         || '').trim()
const NET         = (import.meta.env.VITE_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015').trim()
const RPC_URL     = (import.meta.env.VITE_SOROBAN_RPC_URL   || 'https://soroban-testnet.stellar.org').trim()
const DUMMY       = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN'

export const rpc = new StellarSdk.rpc.Server(RPC_URL)

export async function connectWallet() {
  const { isConnected: connected } = await isConnected()
  if (!connected) throw new Error('Freighter not installed.')
  const { address, error } = await requestAccess()
  if (error) throw new Error(error)
  return address
}

async function sendTx(publicKey, op) {
  const account = await rpc.getAccount(publicKey)
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE, networkPassphrase: NET,
  }).addOperation(op).setTimeout(60).build()
  const sim = await rpc.simulateTransaction(tx)
  if (StellarSdk.rpc.Api.isSimulationError(sim)) throw new Error(sim.error)
  const prepared = StellarSdk.rpc.assembleTransaction(tx, sim).build()
  const result = await signTransaction(prepared.toXDR(), { networkPassphrase: NET })
  if (result.error) throw new Error(result.error)
  const signed = StellarSdk.TransactionBuilder.fromXDR(result.signedTxXdr, NET)
  const sent = await rpc.sendTransaction(signed)
  return pollTx(sent.hash)
}

async function pollTx(hash) {
  for (let i = 0; i < 30; i++) {
    const r = await rpc.getTransaction(hash)
    if (r.status === 'SUCCESS') return hash
    if (r.status === 'FAILED')  throw new Error('Transaction failed on-chain')
    await new Promise(r => setTimeout(r, 2000))
  }
  throw new Error('Transaction timed out')
}

async function readContract(op) {
  const dummy = new StellarSdk.Account(DUMMY, '0')
  const tx = new StellarSdk.TransactionBuilder(dummy, {
    fee: StellarSdk.BASE_FEE, networkPassphrase: NET,
  }).addOperation(op).setTimeout(30).build()
  const sim = await rpc.simulateTransaction(tx)
  return StellarSdk.scValToNative(sim.result.retval)
}

async function approveXlm(publicKey, stroops) {
  return sendTx(publicKey, new StellarSdk.Contract(XLM_TOKEN).call(
    'approve',
    StellarSdk.Address.fromString(publicKey).toScVal(),
    StellarSdk.Address.fromString(CONTRACT_ID).toScVal(),
    new StellarSdk.XdrLargeInt('i128', BigInt(stroops)).toI128(),
    StellarSdk.xdr.ScVal.scvU32(3_110_400),
  ))
}

const tc = () => new StellarSdk.Contract(CONTRACT_ID)

export async function createSafe(creator, label, owners, threshold, recipient, amountXlm) {
  const stroops = Math.ceil(amountXlm * 10_000_000)
  await approveXlm(creator, stroops)
  return sendTx(creator, tc().call(
    'create_safe',
    StellarSdk.Address.fromString(creator).toScVal(),
    StellarSdk.xdr.ScVal.scvString(label),
    StellarSdk.xdr.ScVal.scvVec(owners.map(o => StellarSdk.Address.fromString(o).toScVal())),
    StellarSdk.xdr.ScVal.scvU32(threshold),
    StellarSdk.Address.fromString(recipient).toScVal(),
    new StellarSdk.XdrLargeInt('i128', BigInt(stroops)).toI128(),
    StellarSdk.Address.fromString(XLM_TOKEN).toScVal(),
  ))
}

export async function approveSafe(owner, safeId) {
  return sendTx(owner, tc().call(
    'approve',
    StellarSdk.Address.fromString(owner).toScVal(),
    StellarSdk.xdr.ScVal.scvU64(new StellarSdk.xdr.Uint64(BigInt(safeId))),
    StellarSdk.Address.fromString(XLM_TOKEN).toScVal(),
  ))
}

export async function revokeSafe(owner, safeId) {
  return sendTx(owner, tc().call(
    'revoke',
    StellarSdk.Address.fromString(owner).toScVal(),
    StellarSdk.xdr.ScVal.scvU64(new StellarSdk.xdr.Uint64(BigInt(safeId))),
  ))
}

export async function cancelSafe(creator, safeId) {
  return sendTx(creator, tc().call(
    'cancel',
    StellarSdk.Address.fromString(creator).toScVal(),
    StellarSdk.xdr.ScVal.scvU64(new StellarSdk.xdr.Uint64(BigInt(safeId))),
    StellarSdk.Address.fromString(XLM_TOKEN).toScVal(),
  ))
}

export async function getSafe(safeId) {
  try {
    return await readContract(tc().call(
      'get_safe',
      StellarSdk.xdr.ScVal.scvU64(new StellarSdk.xdr.Uint64(BigInt(safeId)))
    ))
  } catch { return null }
}

export async function getOwnerSafes(owner) {
  try {
    const ids = await readContract(tc().call(
      'get_owner_safes',
      StellarSdk.Address.fromString(owner).toScVal(),
    ))
    return Array.isArray(ids) ? ids.map(Number) : []
  } catch { return [] }
}

export async function getSafeCount() {
  try { return Number(await readContract(tc().call('count'))) }
  catch { return 0 }
}

export const xlm   = s => (Number(s) / 10_000_000).toFixed(2)
export const short = a => a ? `${a.toString().slice(0,5)}…${a.toString().slice(-4)}` : '—'
export { CONTRACT_ID }
