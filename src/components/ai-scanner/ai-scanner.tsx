import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '@/hooks/useStore';
import { DBOT_TABS } from '@/constants/bot-contents';
import { load } from '@/external/bot-skeleton';
import { save_types } from '@/external/bot-skeleton/constants/save-type';
import { scanMarkets, ScanResult, Strategy, ScanProgress } from './ai-scanner-service';
import './ai-scanner.scss';

// ─── strategy config ──────────────────────────────────────────────────────────

type StrategyConfig = {
    id: Strategy;
    label: string;
    title: string;
    description: string;
    contractType: string;   // read-only display value
    tradeTypeName: string;  // read-only display value
    predictionDigit: number | null; // null for even/odd (direction from scanner)
    xmlFile: string;
    botName: string;
};

const STRATEGIES: StrategyConfig[] = [
    {
        id: 'over1under8',
        label: 'Over1/Under8',
        title: 'Over 1 / Under 8',
        description: 'Scanner picks the best market. Bot trades Over 1; recovers to Under 8 on loss.',
        contractType: 'Over / Under',
        tradeTypeName: 'Digits',
        predictionDigit: 1,
        xmlFile: 'frosty_over_under_ai_bot',
        botName: 'Frosty Over/Under AI Bot',
    },
    {
        id: 'over2under7',
        label: 'Over2/Under7',
        title: 'Over 2 / Under 7',
        description: 'Scanner picks the best market. Bot trades Over 2; recovers to Under 7 on loss.',
        contractType: 'Over / Under',
        tradeTypeName: 'Digits',
        predictionDigit: 2,
        xmlFile: 'frosty_over_under_ai_bot',
        botName: 'Frosty Over/Under AI Bot',
    },
    {
        id: 'over3under6',
        label: 'Over3/Under6',
        title: 'Over 3 / Under 6',
        description: 'Scanner picks the best market. Bot trades Over 3; recovers to Under 6 on loss.',
        contractType: 'Over / Under',
        tradeTypeName: 'Digits',
        predictionDigit: 3,
        xmlFile: 'frosty_over_under_ai_bot',
        botName: 'Frosty Over/Under AI Bot',
    },
    {
        id: 'evenodd',
        label: 'Even/Odd',
        title: 'Even / Odd',
        description: 'Scanner picks the best market and direction (Even or Odd) based on digit frequency.',
        contractType: 'Even / Odd',
        tradeTypeName: 'Digits',
        predictionDigit: null,
        xmlFile: 'frosty_even_odd_ai_bot',
        botName: 'Frosty Even/Odd AI Bot',
    },
];

type ScanState = 'idle' | 'scanning' | 'done' | 'error';

// ─── XML injection helpers ────────────────────────────────────────────────────

/**
 * Replaces the initialisation value of a Blockly variable in an XML string.
 * Finds the first `<field name="VAR" id="${varId}">` then lazily scans to the
 * first `<field name="NUM">` — which, inside a variables_set init block, is
 * always the initial numeric value.
 */
function replaceVarInit(xml: string, varId: string, value: number): string {
    const escaped = varId.replace(/[.*+?^${}()|[\]\\`]/g, '\\$&');
    return xml.replace(
        new RegExp(`(id="${escaped}"[^<]*<\\/field>[\\s\\S]*?<field name="NUM">)[\\d.]+(?=<\\/field>)`),
        `$1${value}`
    );
}

type InjectOpts = {
    symbol: string;
    stake: number;
    martingale: number;
    takeProfit: number;
    stopLoss: number;
    predictionDigit?: number;  // over/under only
    tradeType?: string;        // even/odd only ("Even" | "Odd")
};

function injectOverUnderParams(xml: string, opts: InjectOpts): string {
    xml = xml.replace(/(<field name="SYMBOL_LIST">)[^<]+/, `$1${opts.symbol}`);
    if (opts.predictionDigit !== undefined) {
        // VAR id: a6O1@UOPwLx_RSp+20T$  (prediction)
        xml = replaceVarInit(xml, 'a6O1@UOPwLx_RSp+20T$', opts.predictionDigit);
    }
    // VAR id: 9dQ4tsj$@`vWpu;:2{K=  (STAKE)
    xml = replaceVarInit(xml, '9dQ4tsj$@`vWpu;:2{K=', opts.stake);
    // VAR id: /D.KK%;1:%C[vPyr}FX9  (MARTINGALE)
    xml = replaceVarInit(xml, '/D.KK%;1:%C[vPyr}FX9', opts.martingale);
    // VAR id: :Fbza.{0*q*jalJ+tc#.  (TAKE PROFIT)
    xml = replaceVarInit(xml, ':Fbza.{0*q*jalJ+tc#.', opts.takeProfit);
    // VAR id: BTQ{$u318X:bRnhP(mQ9  (STOP LOSS)
    xml = replaceVarInit(xml, 'BTQ{$u318X:bRnhP(mQ9', opts.stopLoss);
    return xml;
}

function injectEvenOddParams(xml: string, opts: InjectOpts): string {
    if (opts.tradeType !== 'Even' && opts.tradeType !== 'Odd') {
        throw new Error(`[AiScanner] Invalid even/odd trade direction: "${opts.tradeType}". Expected "Even" or "Odd".`);
    }
    xml = xml.replace(/(<field name="SYMBOL_LIST">)[^<]+/, `$1${opts.symbol}`);
    // VAR id: xd#F6X!PKV4M@A!Ya@5R  (stake)
    xml = replaceVarInit(xml, 'xd#F6X!PKV4M@A!Ya@5R', opts.stake);
    // VAR id: I=[4-i8Yh!8yyyJ@i`3I  (martingale)
    xml = replaceVarInit(xml, 'I=[4-i8Yh!8yyyJ@i`3I', opts.martingale);
    // VAR id: 1:(EhN=[H:b-?Xr#{Df+  (take_profit)
    xml = replaceVarInit(xml, '1:(EhN=[H:b-?Xr#{Df+', opts.takeProfit);
    // VAR id: rXm$y.Rn8Ec_$@!MDo^e  (stop_loss)
    xml = replaceVarInit(xml, 'rXm$y.Rn8Ec_$@!MDo^e', opts.stopLoss);
    // Purchase direction (Even → DIGITEVEN, Odd → DIGITODD)
    const purchase = opts.tradeType === 'Even' ? 'DIGITEVEN' : 'DIGITODD';
    xml = xml.replace(/(<field name="PURCHASE_LIST">)[^<]+/, `$1${purchase}`);
    return xml;
}

// ─── component ────────────────────────────────────────────────────────────────

const AiScanner = () => {
    const store = useStore();

    // ── drag state ───────────────────────────────────────────────────────────
    const [pos, setPos] = useState({ right: 24, bottom: 120 });
    const isDragging = useRef(false);
    const hasDragged = useRef(false);
    const dragStart = useRef({ x: 0, y: 0, right: 0, bottom: 0 });
    const btnRef = useRef<HTMLButtonElement>(null);

    const onPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
        if (e.button !== 0 && e.pointerType !== 'touch') return;
        isDragging.current = true;
        hasDragged.current = false;
        dragStart.current = { x: e.clientX, y: e.clientY, right: pos.right, bottom: pos.bottom };
        btnRef.current?.setPointerCapture(e.pointerId);
    }, [pos]);

    const onPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
        if (!isDragging.current) return;
        const dx = e.clientX - dragStart.current.x;
        const dy = e.clientY - dragStart.current.y;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) hasDragged.current = true;
        setPos({ right: Math.max(8, dragStart.current.right - dx), bottom: Math.max(8, dragStart.current.bottom - dy) });
    }, []);

    const onPointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
        isDragging.current = false;
        btnRef.current?.releasePointerCapture(e.pointerId);
    }, []);

    // ── scanner state ─────────────────────────────────────────────────────────
    const [isOpen, setIsOpen] = useState(false);
    const [activeStrategyIdx, setActiveStrategyIdx] = useState(0);
    const [ticks, setTicks] = useState(3000);
    const [scanState, setScanState] = useState<ScanState>('idle');
    const [progress, setProgress] = useState<ScanProgress | null>(null);
    const [results, setResults] = useState<ScanResult[]>([]);
    const [statusMsg, setStatusMsg] = useState('');

    // ── editable bot parameters ───────────────────────────────────────────────
    const [stake, setStake] = useState(1);
    const [martingale, setMartingale] = useState(1.5);
    const [takeProfit, setTakeProfit] = useState(5);
    const [stopLoss, setStopLoss] = useState(10);

    const abortRef = useRef<AbortController | null>(null);
    const strategy = STRATEGIES[activeStrategyIdx];

    useEffect(() => {
        if (scanState === 'scanning') abortRef.current?.abort();
        setScanState('idle');
        setResults([]);
        setProgress(null);
        setStatusMsg('');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeStrategyIdx]);

    // ── best result (auto-selected #1) ───────────────────────────────────────
    const bestResult: ScanResult | null = results[0] ?? null;

    // ── AI-determined display values ──────────────────────────────────────────
    const aiMarket = scanState === 'done' && bestResult ? bestResult.name : '—';
    // "Digits" is the Deriv trade-type category for both bot types
    const aiTradeType = scanState === 'done' && bestResult ? strategy.tradeTypeName : '—';
    const aiContractType = scanState === 'done' && bestResult ? strategy.contractType : '—';
    // For over/under the bot always starts on the "over" digit (e.g. Over 2);
    // for even/odd the scanner determines direction (Even or Odd).
    const aiPrediction = scanState === 'done' && bestResult
        ? strategy.id === 'evenodd'
            ? bestResult.tradeType               // 'Even' or 'Odd'
            : `Over ${strategy.predictionDigit}` // matches what's injected
        : '—';

    const progressPct =
        progress && progress.total > 0 ? Math.round(((progress.index + 1) / progress.total) * 100) : 0;

    function statusFor(state: ScanState, prog: ScanProgress | null, res: ScanResult[]): string {
        switch (state) {
            case 'idle':     return `Ready — set parameters and scan`;
            case 'scanning': return prog ? `Scanning ${prog.symbol} (${prog.index + 1}/${prog.total})…` : 'Starting…';
            case 'done':     return res.length === 0 ? 'No results — check connection.' : `Best: ${res[0].name} — ${res[0].tradeType} (${res[0].percentage})`;
            case 'error':    return 'Scan failed. Check connection and retry.';
        }
    }

    // ── handlers ──────────────────────────────────────────────────────────────
    const handleToggle = () => {
        if (hasDragged.current) return;
        setIsOpen(o => !o);
    };

    const handleScan = async () => {
        if (scanState === 'scanning') {
            abortRef.current?.abort();
            setScanState('idle');
            setStatusMsg(statusFor('idle', null, []));
            return;
        }
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        setScanState('scanning');
        setResults([]);
        setProgress(null);
        setStatusMsg('Starting scan…');
        try {
            const res = await scanMarkets(strategy.id, ticks, p => {
                setProgress(p);
                setStatusMsg(statusFor('scanning', p, []));
            }, ctrl.signal);
            if (ctrl.signal.aborted) return;
            setResults(res);
            setScanState('done');
            setStatusMsg(statusFor('done', null, res));
        } catch {
            if (ctrl.signal.aborted) return;
            setScanState('error');
            setStatusMsg(statusFor('error', null, []));
        }
    };

    const handleLoadBot = async () => {
        if (!bestResult) return;

        try {
            const xml_module = await import(`../../xml/${strategy.xmlFile}.xml`);
            let block_string: string = xml_module.default;

            const opts: InjectOpts = {
                symbol: bestResult.symbol,
                stake,
                martingale,
                takeProfit,
                stopLoss,
                predictionDigit: strategy.predictionDigit ?? undefined,
                tradeType: bestResult.tradeType,
            };

            block_string = strategy.id === 'evenodd'
                ? injectEvenOddParams(block_string, opts)
                : injectOverUnderParams(block_string, opts);

            if (store?.dashboard) store.dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);
            setIsOpen(false);

            const doLoad = async (workspace: any) => {
                await load({
                    block_string,
                    workspace,
                    file_name: strategy.botName,
                    from: save_types.LOCAL,
                    show_snackbar: true,
                    drop_event: undefined,
                    strategy_id: undefined,
                    showIncompatibleStrategyDialog: undefined,
                });
            };

            const workspace = (window as any).Blockly?.derivWorkspace;
            if (workspace) {
                await doLoad(workspace);
            } else {
                setTimeout(async () => {
                    const ws = (window as any).Blockly?.derivWorkspace;
                    if (ws) await doLoad(ws);
                }, 800);
            }
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[AiScanner] Failed to load bot XML:', err);
        }
    };

    const handleClose = () => {
        abortRef.current?.abort();
        setIsOpen(false);
    };

    // ── number field helpers ──────────────────────────────────────────────────
    const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val));
    const parseNum = (s: string, fallback: number) => { const n = parseFloat(s); return isNaN(n) ? fallback : n; };

    const modalStyle: React.CSSProperties = {
        position: 'fixed',
        bottom: pos.bottom + 64,
        right: pos.right,
    };

    // ─────────────────────────────────────────────────────────────────────────

    return (
        <>
            {/* ── Draggable trigger button ──────────────────────────────── */}
            <button
                ref={btnRef}
                className={`ai-scanner-trigger${isOpen ? ' ai-scanner-trigger--active' : ''}`}
                style={{ position: 'fixed', right: pos.right, bottom: pos.bottom }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onClick={handleToggle}
                aria-label='AI Entry Scanner'
                title='AI Entry Scanner'
                touch-action='none'
            >
                <span>AI</span>
                <div className='ai-scanner-trigger__dot' />
            </button>

            {isOpen && <div className='ai-scanner-backdrop' onClick={handleClose} />}

            {isOpen && (
                <div className='ai-scanner-modal' style={modalStyle} role='dialog' aria-label='Entry Scanner'>

                    {/* ── Header ───────────────────────────────────────────── */}
                    <div className='ai-scanner-modal__header'>
                        <h3>AI Entry Scanner</h3>
                        <button className='ai-scanner-modal__close' onClick={handleClose} aria-label='Close'>✕</button>
                    </div>

                    {/* ── Strategy tabs ─────────────────────────────────────── */}
                    <div className='ai-scanner-modal__tabs'>
                        {STRATEGIES.map((s, idx) => (
                            <button
                                key={s.id}
                                className={`ai-scanner-modal__tab${idx === activeStrategyIdx ? ' ai-scanner-modal__tab--active' : ''}`}
                                onClick={() => setActiveStrategyIdx(idx)}
                            >
                                {s.label}
                            </button>
                        ))}
                    </div>

                    {/* ── Body ─────────────────────────────────────────────── */}
                    <div className='ai-scanner-modal__body'>

                        {/* Strategy info + ticks */}
                        <div className='ai-scanner-modal__strategy-header'>
                            <div className='ai-scanner-modal__strategy-info'>
                                <h4>{strategy.title}</h4>
                                <p>{strategy.description}</p>
                            </div>
                            <div className='ai-scanner-modal__ticks'>
                                <label>TICKS</label>
                                <input
                                    type='number' min={100} max={5000} step={100}
                                    value={ticks}
                                    onChange={e => setTicks(clamp(parseInt(e.target.value) || 100, 100, 5000))}
                                    disabled={scanState === 'scanning'}
                                />
                            </div>
                        </div>

                        {/* ── Bot Parameters (editable) ──────────────────── */}
                        <div className='ai-scanner-modal__section-label'>BOT PARAMETERS</div>
                        <div className='ai-scanner-modal__params'>
                            <div className='ai-scanner-modal__param'>
                                <label>STAKE</label>
                                <input
                                    type='number' min={0.35} step={0.01}
                                    value={stake}
                                    onChange={e => setStake(clamp(parseNum(e.target.value, 1), 0.35, 9999))}
                                    disabled={scanState === 'scanning'}
                                />
                            </div>
                            <div className='ai-scanner-modal__param'>
                                <label>MARTINGALE</label>
                                <input
                                    type='number' min={1} step={0.1}
                                    value={martingale}
                                    onChange={e => setMartingale(clamp(parseNum(e.target.value, 1.5), 1, 99))}
                                    disabled={scanState === 'scanning'}
                                />
                            </div>
                            <div className='ai-scanner-modal__param'>
                                <label>TAKE PROFIT</label>
                                <input
                                    type='number' min={1} step={1}
                                    value={takeProfit}
                                    onChange={e => setTakeProfit(clamp(parseNum(e.target.value, 5), 1, 99999))}
                                    disabled={scanState === 'scanning'}
                                />
                            </div>
                            <div className='ai-scanner-modal__param'>
                                <label>STOP LOSS</label>
                                <input
                                    type='number' min={1} step={1}
                                    value={stopLoss}
                                    onChange={e => setStopLoss(clamp(parseNum(e.target.value, 10), 1, 99999))}
                                    disabled={scanState === 'scanning'}
                                />
                            </div>
                        </div>

                        {/* ── AI Scanner Results (read-only) ─────────────── */}
                        <div className='ai-scanner-modal__section-label'>AI SCANNER RESULTS</div>
                        <div className='ai-scanner-modal__fields'>
                            <div className='ai-scanner-modal__field'>
                                <label>MARKET</label>
                                <span className={scanState === 'done' && bestResult ? 'ai-scanner-modal__field-value--ai' : ''} title={aiMarket}>{aiMarket}</span>
                            </div>
                            <div className='ai-scanner-modal__field'>
                                <label>TRADE TYPE</label>
                                <span>{aiTradeType}</span>
                            </div>
                            <div className='ai-scanner-modal__field'>
                                <label>CONTRACT TYPE</label>
                                <span className={scanState === 'done' && bestResult ? 'ai-scanner-modal__field-value--ai' : ''}>{aiContractType}</span>
                            </div>
                            <div className='ai-scanner-modal__field'>
                                <label>PREDICTION</label>
                                <span className={scanState === 'done' && bestResult ? 'ai-scanner-modal__field-value--ai' : ''}>{aiPrediction}</span>
                            </div>
                        </div>

                        {/* Progress bar */}
                        {scanState === 'scanning' && (
                            <div className='ai-scanner-modal__progress'>
                                <div className='ai-scanner-modal__progress-bar' style={{ width: `${progressPct}%` }} />
                            </div>
                        )}

                        {/* Status */}
                        <div className={`ai-scanner-modal__status${scanState !== 'idle' ? ` ai-scanner-modal__status--${scanState}` : ''}`}>
                            {scanState === 'scanning' && <div className='ai-scanner-spinner' />}
                            {statusMsg || statusFor(scanState, progress, results)}
                        </div>

                        {/* Ranked results list */}
                        {results.length > 0 && (
                            <div className='ai-scanner-modal__results'>
                                {results.map((r, idx) => (
                                    <div
                                        key={r.symbol}
                                        className={[
                                            'ai-scanner-modal__result-row',
                                            idx === 0 ? 'ai-scanner-modal__result-row--best' : '',
                                        ].filter(Boolean).join(' ')}
                                    >
                                        <span className='ai-scanner-modal__result-rank'>#{idx + 1}</span>
                                        <span className='ai-scanner-modal__result-name'>{r.name}</span>
                                        <span className='ai-scanner-modal__result-type'>{r.tradeType}</span>
                                        <span className='ai-scanner-modal__result-pct'>{r.percentage}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Action buttons */}
                        <div className='ai-scanner-modal__actions'>
                            <button className='ai-scanner-modal__btn ai-scanner-modal__btn--primary' onClick={handleScan}>
                                {scanState === 'scanning' ? 'Stop Scan' : 'Scan Markets'}
                            </button>
                            <button
                                className='ai-scanner-modal__btn ai-scanner-modal__btn--secondary'
                                onClick={handleLoadBot}
                                disabled={scanState !== 'done' || !bestResult}
                            >
                                Load Bot
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default AiScanner;
