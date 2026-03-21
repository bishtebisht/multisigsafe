import { useState, useEffect } from 'react'
import {
  connectWallet, createSafe, approveSafe, revokeSafe, cancelSafe,
  getSafe, getOwnerSafes, getSafeCount,
  xlm, short, CONTRACT_ID,
} from './lib/stellar'

// ── Approval ring ──────────────────────────────────────────────────────────
function ApprovalRing({ approved, total, threshold }) {
  const r = 40, circ = 2 * Math.PI * r
  const pct      = total > 0 ? approved / total : 0
  const threshPct= total > 0 ? threshold / total : 0
  const dash     = pct * circ
  const executed = approved >= threshold

  return (
    <div className="approval-ring-wrap">
      <svg width="96" height="96" viewBox="0 0 96 96">
        {/* Track */}
        <circle cx="48" cy="48" r={r} fill="none"
          stroke="rgba(255,255,255,0.06)" strokeWidth="6"/>
        {/* Threshold marker */}
        <circle cx="48" cy="48" r={r} fill="none"
          stroke="rgba(255,200,50,0.3)" strokeWidth="6"
          strokeDasharray={`2 ${circ - 2}`}
          strokeDashoffset={circ * 0.25 - threshPct * circ}
        />
        {/* Fill */}
        <circle cx="48" cy="48" r={r} fill="none"
          stroke={executed ? '#4ade80' : '#60a5fa'}
          strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          strokeDashoffset={circ * 0.25}
          style={{ transition: 'stroke-dasharray 0.5s ease',
            filter: executed ? 'drop-shadow(0 0 6px #4ade80)' : 'drop-shadow(0 0 4px #60a5fa)' }}
        />
        <text x="48" y="44" textAnchor="middle" className="ring-big"
          style={{ fill: executed ? '#4ade80' : '#e2e8f0' }}>
          {approved}/{total}
        </text>
        <text x="48" y="60" textAnchor="middle" className="ring-small">
          need {threshold}
        </text>
      </svg>
    </div>
  )
}

// ── Owner row ──────────────────────────────────────────────────────────────
function OwnerRow({ address, approved, isYou }) {
  return (
    <div className={`owner-row ${approved ? 'or-signed' : 'or-pending'}`}>
      <div className="or-icon">{approved ? '✓' : '○'}</div>
      <div className="or-addr">{short(address)}{isYou ? ' (you)' : ''}</div>
      <div className={`or-status ${approved ? 'ors-signed' : 'ors-pending'}`}>
        {approved ? 'Signed' : 'Pending'}
      </div>
    </div>
  )
}

// ── Safe card ──────────────────────────────────────────────────────────────
function SafeCard({ safe, wallet, onAction }) {
  const [busy, setBusy] = useState(false)

  const owners     = Array.isArray(safe.owners)    ? safe.owners    : []
  const approvals  = Array.isArray(safe.approvals) ? safe.approvals : []
  const isOwner    = wallet && owners.some(o => o.toString() === wallet)
  const hasApproved= wallet && approvals.some(a => a.toString() === wallet)
  const isCreator  = wallet && safe.created_by?.toString() === wallet
  const isActive   = safe.status === 'Active'
  const isExecuted = safe.status === 'Executed'

  const handle = async (fn, msg) => {
    setBusy(true)
    try {
      const hash = await fn()
      onAction({ ok: true, msg, hash, refresh: true })
    } catch (e) { onAction({ ok: false, msg: e.message }) }
    finally { setBusy(false) }
  }

  const statusLabel = {
    Active:    '◈ ACTIVE',
    Executed:  '✓ EXECUTED',
    Cancelled: '✗ CANCELLED',
  }[safe.status] || safe.status

  return (
    <div className={`safe-card ${isExecuted ? 'card-executed' : ''} ${safe.status === 'Cancelled' ? 'card-cancelled' : ''}`}>
      {/* Glow for executed */}
      {isExecuted && <div className="exec-glow" />}

      <div className="sc-header">
        <div>
          <div className="sc-id">SAFE #{safe.id?.toString().padStart(4,'0')}</div>
          <div className="sc-label">{safe.label}</div>
        </div>
        <span className={`sc-status ${safe.status === 'Active' ? 'ss-active' : safe.status === 'Executed' ? 'ss-exec' : 'ss-cancel'}`}>
          {statusLabel}
        </span>
      </div>

      {/* Amount + ring */}
      <div className="sc-body">
        <div className="sc-amount-block">
          <div className="sc-amount">{xlm(safe.amount)}</div>
          <div className="sc-amount-label">XLM</div>
          <div className="sc-recipient">→ {short(safe.recipient)}</div>
        </div>
        <ApprovalRing
          approved={approvals.length}
          total={owners.length}
          threshold={Number(safe.threshold)}
        />
      </div>

      {/* Owner list */}
      <div className="sc-owners">
        <div className="sc-owners-title">SIGNERS ({Number(safe.threshold)} OF {owners.length} REQUIRED)</div>
        {owners.map((o, i) => (
          <OwnerRow
            key={i}
            address={o.toString()}
            approved={approvals.some(a => a.toString() === o.toString())}
            isYou={wallet && o.toString() === wallet}
          />
        ))}
      </div>

      {/* Actions */}
      {wallet && isActive && (
        <div className="sc-actions">
          {isOwner && !hasApproved && (
            <button className="btn-approve-safe" disabled={busy}
              onClick={() => handle(() => approveSafe(wallet, safe.id), `Approved safe #${safe.id}`)}>
              {busy ? 'Signing…' : '✓ Sign & Approve'}
            </button>
          )}
          {isOwner && hasApproved && (
            <button className="btn-revoke-safe" disabled={busy}
              onClick={() => handle(() => revokeSafe(wallet, safe.id), 'Approval revoked')}>
              {busy ? '…' : 'Revoke Signature'}
            </button>
          )}
          {isCreator && (
            <button className="btn-cancel-safe" disabled={busy}
              onClick={() => handle(() => cancelSafe(wallet, safe.id), 'Safe cancelled, funds returned')}>
              {busy ? '…' : 'Cancel & Refund'}
            </button>
          )}
        </div>
      )}

      {isExecuted && (
        <div className="exec-banner">
          ✓ Executed — {xlm(safe.amount)} XLM released to {short(safe.recipient)}
        </div>
      )}
    </div>
  )
}

// ── Create safe form ───────────────────────────────────────────────────────
function CreateSafeForm({ wallet, onCreated }) {
  const [label,     setLabel]     = useState('')
  const [recipient, setRecipient] = useState('')
  const [amountXlm, setAmountXlm] = useState('10')
  const [owners,    setOwners]    = useState(['', ''])
  const [threshold, setThreshold] = useState(2)
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState('')

  // Lock first slot to connected wallet
  useEffect(() => {
    if (wallet) setOwners(prev => { const n=[...prev]; n[0]=wallet; return n })
  }, [wallet])

  const updateOwner = (i, v) => setOwners(prev => { const n=[...prev]; n[i]=v; return n })
  const addOwner    = () => { if (owners.length < 8) setOwners([...owners, '']) }
  const removeOwner = (i) => { if (i === 0) return; setOwners(owners.filter((_,idx) => idx!==i)) }

  const validOwners = owners.filter(o => o.trim().length > 0)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (validOwners.length < 2) { setErr('At least 2 owners required'); return }
    setBusy(true); setErr('')
    try {
      const hash = await createSafe(wallet, label, validOwners, threshold, recipient, parseFloat(amountXlm))
      onCreated(hash)
      setLabel(''); setRecipient(''); setAmountXlm('10')
      setOwners([wallet, ''])
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  return (
    <form className="create-form" onSubmit={handleSubmit}>
      <div className="cf-title">CREATE SAFE</div>

      <div className="cf-field">
        <label>LABEL</label>
        <input value={label} onChange={e => setLabel(e.target.value)}
          placeholder='e.g. "Team Treasury 2-of-3"'
          maxLength={60} required disabled={busy} />
      </div>

      <div className="cf-field">
        <label>RECIPIENT ADDRESS</label>
        <input value={recipient} onChange={e => setRecipient(e.target.value)}
          placeholder="G… — released here when threshold is met"
          required disabled={busy} />
      </div>

      <div className="cf-field">
        <label>AMOUNT (XLM)</label>
        <div className="amount-presets">
          {['1','5','10','25','100'].map(v => (
            <button key={v} type="button"
              className={`amt-preset ${amountXlm===v ? 'amt-active' : ''}`}
              onClick={() => setAmountXlm(v)}>{v}</button>
          ))}
        </div>
        <input type="number" min="0.1" step="0.1"
          value={amountXlm} onChange={e => setAmountXlm(e.target.value)}
          className="amt-custom" required disabled={busy} />
        <span className="cf-unit">XLM</span>
      </div>

      <div className="cf-field">
        <label>OWNERS ({validOwners.length} of 8 max)</label>
        <div className="owners-list">
          {owners.map((o, i) => (
            <div key={i} className="owner-input-row">
              <input value={o} onChange={e => updateOwner(i, e.target.value)}
                placeholder={i === 0 ? 'Your address (creator)' : `Owner ${i+1}…`}
                disabled={i === 0 || busy}
                className={i === 0 ? 'oi-input oi-you' : 'oi-input'} />
              {i > 0 && (
                <button type="button" className="btn-rm-owner"
                  onClick={() => removeOwner(i)}>×</button>
              )}
            </div>
          ))}
          {owners.length < 8 && (
            <button type="button" className="btn-add-owner" onClick={addOwner}>
              + Add owner
            </button>
          )}
        </div>
      </div>

      <div className="cf-field">
        <label>THRESHOLD (M of {validOwners.length})</label>
        <div className="threshold-row">
          {Array.from({ length: validOwners.length }, (_, i) => i + 1).map(n => (
            <button key={n} type="button"
              className={`thresh-btn ${threshold === n ? 'thresh-active' : ''}`}
              onClick={() => setThreshold(n)}>
              {n}
            </button>
          ))}
        </div>
        <span className="cf-hint">
          {threshold} of {validOwners.length} signers must approve to release funds.
        </span>
      </div>

      {err && <p className="cf-err">{err}</p>}

      <button type="submit" className="btn-create-safe"
        disabled={!wallet || busy || !label || !recipient || validOwners.length < 2}>
        {!wallet ? 'Connect wallet first' : busy ? 'Deploying safe…' : `🔒 Lock ${amountXlm} XLM`}
      </button>
    </form>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function App() {
  const [wallet,    setWallet]    = useState(null)
  const [safes,     setSafes]     = useState([])
  const [safeCount, setSafeCount] = useState(0)
  const [loading,   setLoading]   = useState(false)
  const [tab,       setTab]       = useState('mysafes')
  const [lookupId,  setLookupId]  = useState('')
  const [lookupRes, setLookupRes] = useState(null)
  const [toast,     setToast]     = useState(null)

  const loadMySafes = async (addr) => {
    setLoading(true)
    try {
      const [ids, count] = await Promise.all([
        getOwnerSafes(addr),
        getSafeCount(),
      ])
      setSafeCount(count)
      const loaded = await Promise.allSettled(
        [...ids].reverse().slice(0, 10).map(id => getSafe(id))
      )
      setSafes(loaded.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value))
    } catch {}
    setLoading(false)
  }

  useEffect(() => {
    getSafeCount().then(setSafeCount)
  }, [])

  const handleConnect = async () => {
    try {
      const addr = await connectWallet()
      setWallet(addr)
      loadMySafes(addr)
    } catch (e) { showToast(false, e.message) }
  }

  const showToast = (ok, msg, hash) => {
    setToast({ ok, msg, hash })
    setTimeout(() => setToast(null), 6000)
  }

  const handleAction = ({ ok, msg, hash, refresh }) => {
    showToast(ok, msg, hash)
    if (ok && refresh && wallet) loadMySafes(wallet)
  }

  const handleCreated = (hash) => {
    showToast(true, 'Safe deployed! Waiting for co-signers.', hash)
    setTab('mysafes')
    if (wallet) loadMySafes(wallet)
  }

  const handleLookup = async (e) => {
    e.preventDefault()
    try {
      const s = await getSafe(parseInt(lookupId))
      setLookupRes(s)
    } catch { showToast(false, 'Safe not found') }
  }

  return (
    <div className="app">
      <div className="bg-grid" aria-hidden />

      {/* ── Header ── */}
      <header className="header">
        <div className="brand">
          <div className="brand-shield">🔒</div>
          <div>
            <div className="brand-name">MultiSigSafe</div>
            <div className="brand-sub">N-OF-M VAULT · STELLAR SOROBAN</div>
          </div>
        </div>

        <div className="header-stats">
          <div className="hs"><span className="hs-n">{safeCount}</span><span className="hs-l">SAFES CREATED</span></div>
        </div>

        <div className="header-right">
          {wallet
            ? <div className="wallet-pill"><span className="wdot"/>{short(wallet)}</div>
            : <button className="btn-connect" onClick={handleConnect}>Connect Wallet</button>
          }
        </div>
      </header>

      {/* ── Tabs ── */}
      <div className="tab-bar">
        {[
          { id: 'mysafes', label: 'My Safes' },
          { id: 'create',  label: '+ New Safe' },
          { id: 'lookup',  label: 'Look Up' },
        ].map(t => (
          <button key={t.id}
            className={`tab-btn ${tab === t.id ? 'tab-active' : ''}`}
            onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
        {wallet && <button className="tab-refresh" onClick={() => loadMySafes(wallet)}>↻</button>}
        <a className="tab-contract"
          href={`https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`}
          target="_blank" rel="noreferrer">Contract ↗</a>
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div className={`toast ${toast.ok ? 'toast-ok' : 'toast-err'}`}>
          <span>{toast.msg}</span>
          {toast.hash && (
            <a href={`https://stellar.expert/explorer/testnet/tx/${toast.hash}`}
              target="_blank" rel="noreferrer" className="toast-link">TX ↗</a>
          )}
        </div>
      )}

      {/* ── Body ── */}
      <main className="main">
        {tab === 'mysafes' && (
          !wallet ? (
            <div className="connect-prompt">
              <div className="cp-shield">🔒</div>
              <h2 className="cp-title">Multi-signature XLM vaults.</h2>
              <p className="cp-sub">Lock XLM behind N-of-M wallet approvals. Funds only release when the threshold is met. Trustless, on-chain, unstoppable.</p>
              <button className="btn-connect-lg" onClick={handleConnect}>Connect Freighter</button>
            </div>
          ) : loading ? (
            <div className="loading-state">
              <div className="ls-icon">🔒</div>
              <p>Loading your safes…</p>
            </div>
          ) : safes.length === 0 ? (
            <div className="empty-state">
              <div className="es-icon">🔒</div>
              <div className="es-title">No safes yet.</div>
              <p className="es-sub">Create a multi-sig safe or ask a co-signer to add your address as an owner.</p>
              <button className="btn-new-safe" onClick={() => setTab('create')}>Create Safe</button>
            </div>
          ) : (
            <div className="safe-grid">
              {safes.map(s => (
                <SafeCard key={s.id?.toString()} safe={s}
                  wallet={wallet} onAction={handleAction} />
              ))}
            </div>
          )
        )}

        {tab === 'create' && (
          <div className="page-wrap">
            {!wallet
              ? <div className="connect-prompt">
                  <div className="cp-shield">🔒</div>
                  <p className="cp-sub">Connect Freighter to create a multi-sig safe.</p>
                  <button className="btn-connect-lg" onClick={handleConnect}>Connect</button>
                </div>
              : <CreateSafeForm wallet={wallet} onCreated={handleCreated} />
            }
          </div>
        )}

        {tab === 'lookup' && (
          <div className="page-wrap">
            <form className="lookup-form" onSubmit={handleLookup}>
              <input type="number" min="1"
                value={lookupId} onChange={e => setLookupId(e.target.value)}
                placeholder="Safe ID" className="lookup-input" required />
              <button type="submit" className="btn-lookup">Look Up</button>
            </form>
            {lookupRes && (
              <SafeCard safe={lookupRes} wallet={wallet} onAction={handleAction} />
            )}
          </div>
        )}
      </main>

      <footer className="footer">
        <span>MultiSigSafe · Stellar Testnet · Soroban</span>
        <a href={`https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`}
          target="_blank" rel="noreferrer">Contract ↗</a>
      </footer>
    </div>
  )
}
