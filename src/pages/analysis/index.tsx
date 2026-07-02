// @ts-nocheck — analysis page; store types have known upstream gaps
import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { TContractInfo } from '@/components/summary/summary-card.types';
import { transaction_elements } from '@/constants/transactions';
import { useStore } from '@/hooks/useStore';
import { Localize } from '@deriv-com/translations';
import './analysis.scss';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Extract the last digit (0-9) from a tick value like "12345.67" → 7 */
const getLastDigitFromTick = (tick: string | number | undefined): number | null => {
    if (tick === undefined || tick === null || tick === '') return null;
    const str = String(tick).trim();
    const digits = str.replace(/[^0-9]/g, '');
    if (!digits) return null;
    const d = parseInt(digits.slice(-1), 10);
    return isNaN(d) ? null : d;
};

/** Pull completed contracts out of the raw transactions array */
const getCompleted = (transactions: any[]): TContractInfo[] =>
    transactions
        .filter(t => t.type === transaction_elements.CONTRACT && typeof t.data === 'object')
        .map(t => t.data as TContractInfo)
        .filter(c => c.is_completed);

// ─── Digit Frequency Analyzer ────────────────────────────────────────────────

const DigitFrequency = observer(({ liveDigits }: { liveDigits: number[] }) => {
    const [manualInput, setManualInput] = useState('');
    const [manualDigits, setManualDigits] = useState<number[]>([]);
    const [mode, setMode] = useState<'live' | 'manual'>(liveDigits.length > 0 ? 'live' : 'manual');

    // Sync default mode when live data first arrives
    React.useEffect(() => {
        if (liveDigits.length > 0 && mode === 'manual' && manualDigits.length === 0) {
            setMode('live');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [liveDigits.length]);

    const digits = mode === 'live' ? liveDigits : manualDigits;

    const handleAdd = () => {
        const parsed = manualInput
            .split(/[\s,]+/)
            .map(s => parseInt(s.trim(), 10))
            .filter(n => !isNaN(n) && n >= 0 && n <= 9);
        if (parsed.length > 0) {
            setManualDigits(prev => [...prev, ...parsed]);
            setManualInput('');
        }
    };

    const counts: Record<number, number> = {};
    for (let i = 0; i <= 9; i++) counts[i] = 0;
    digits.forEach(d => { counts[d] = (counts[d] || 0) + 1; });
    const max = Math.max(...Object.values(counts), 1);

    return (
        <div className='analysis__tool'>
            <div className='analysis__tool-header'>
                <div>
                    <h3 className='analysis__tool-title'>
                        <Localize i18n_default_text='Digit Frequency Analyzer' />
                    </h3>
                    <p className='analysis__tool-desc'>
                        {mode === 'live'
                            ? <Localize i18n_default_text='Showing exit-tick last digits from your bot&apos;s completed trades.' />
                            : <Localize i18n_default_text='Enter last-digit values (0–9) to see which digits appear most often.' />
                        }
                    </p>
                </div>
                <div className='analysis__mode-toggle'>
                    <button
                        className={`analysis__mode-btn${mode === 'live' ? ' analysis__mode-btn--active' : ''}`}
                        onClick={() => setMode('live')}
                        disabled={liveDigits.length === 0}
                        title={liveDigits.length === 0 ? 'Run a bot to get live digit data' : ''}
                    >
                        <span className={`analysis__live-dot${liveDigits.length > 0 ? ' analysis__live-dot--on' : ''}`} />
                        Live
                    </button>
                    <button
                        className={`analysis__mode-btn${mode === 'manual' ? ' analysis__mode-btn--active' : ''}`}
                        onClick={() => setMode('manual')}
                    >
                        Manual
                    </button>
                </div>
            </div>

            {mode === 'manual' && (
                <div className='analysis__input-row'>
                    <input
                        className='analysis__input'
                        type='text'
                        value={manualInput}
                        onChange={e => setManualInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleAdd()}
                        placeholder='e.g. 3, 7, 2, 5, 8'
                    />
                    <button className='analysis__btn' onClick={handleAdd}>
                        <Localize i18n_default_text='Add' />
                    </button>
                    <button
                        className='analysis__btn analysis__btn--secondary'
                        onClick={() => setManualDigits([])}
                    >
                        <Localize i18n_default_text='Clear' />
                    </button>
                </div>
            )}

            <p className='analysis__count-label'>
                <Localize i18n_default_text='Total samples: ' />{digits.length}
                {mode === 'live' && liveDigits.length > 0 && (
                    <span className='analysis__live-badge'>LIVE</span>
                )}
            </p>

            <div className='analysis__bar-chart'>
                {Array.from({ length: 10 }, (_, i) => {
                    const count = counts[i];
                    const pct = digits.length > 0 ? ((count / digits.length) * 100).toFixed(1) : '0.0';
                    const barH = max > 0 ? (count / max) * 100 : 0;
                    return (
                        <div key={i} className='analysis__bar-col'>
                            <span className='analysis__bar-pct'>{pct}%</span>
                            <div className='analysis__bar-wrap'>
                                <div className='analysis__bar' style={{ height: `${barH}%` }} />
                            </div>
                            <span className='analysis__bar-label'>{i}</span>
                            <span className='analysis__bar-count'>{count}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
});

// ─── Win / Loss Tracker ──────────────────────────────────────────────────────

type ManualTrade = {
    id: number;
    result: 'win' | 'loss';
    stake: number;
    payout: number;
    timestamp: string;
    source: 'manual';
};

const WinLossTracker = observer(({
    completedTrades,
    liveStats,
}: {
    completedTrades: TContractInfo[];
    liveStats: ReturnType<any>;
}) => {
    const [manualTrades, setManualTrades] = useState<ManualTrade[]>([]);
    const [stake, setStake] = useState('');
    const [payout, setPayout] = useState('');
    const [mode, setMode] = useState<'live' | 'manual'>(completedTrades.length > 0 ? 'live' : 'manual');
    const nextId = React.useRef(1);

    React.useEffect(() => {
        if (completedTrades.length > 0 && mode === 'manual' && manualTrades.length === 0) {
            setMode('live');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [completedTrades.length]);

    const addManual = (result: 'win' | 'loss') => {
        const s = parseFloat(stake) || 0;
        const p = parseFloat(payout) || 0;
        setManualTrades(prev => [
            { id: nextId.current++, result, stake: s, payout: p, timestamp: new Date().toLocaleTimeString(), source: 'manual' },
            ...prev,
        ]);
    };

    // ── aggregate stats ──
    const wins = mode === 'live' ? liveStats.won_contracts : manualTrades.filter(t => t.result === 'win').length;
    const losses = mode === 'live' ? liveStats.lost_contracts : manualTrades.filter(t => t.result === 'loss').length;
    const total = mode === 'live' ? liveStats.number_of_runs : manualTrades.length;
    const netPnL = mode === 'live' ? liveStats.total_profit : manualTrades.reduce((acc, t) => acc + (t.result === 'win' ? t.payout - t.stake : -t.stake), 0);
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';

    // ── recent trades list — computed directly so observer tracks splice updates ──
    const recentLive = completedTrades.slice(0, 20).map(c => ({
        id: c.contract_id,
        result: (Number(c.profit) > 0 ? 'win' : 'loss') as 'win' | 'loss',
        stake: Number(c.buy_price) || 0,
        payout: Number(c.payout) || Number((c as any).bid_price) || 0,
        profit: Number(c.profit) || 0,
        timestamp: typeof c.date_start === 'string' ? c.date_start.split(' ')[1] ?? '' : '',
        symbol: (c as any).display_name || c.underlying_symbol || '',
    }));

    return (
        <div className='analysis__tool'>
            <div className='analysis__tool-header'>
                <div>
                    <h3 className='analysis__tool-title'>
                        <Localize i18n_default_text='Win / Loss Tracker' />
                    </h3>
                    <p className='analysis__tool-desc'>
                        {mode === 'live'
                            ? <Localize i18n_default_text='Live results from your bot. Updates automatically as trades complete.' />
                            : <Localize i18n_default_text='Record each trade result to track your win rate and net profit/loss.' />
                        }
                    </p>
                </div>
                <div className='analysis__mode-toggle'>
                    <button
                        className={`analysis__mode-btn${mode === 'live' ? ' analysis__mode-btn--active' : ''}`}
                        onClick={() => setMode('live')}
                        disabled={completedTrades.length === 0}
                        title={completedTrades.length === 0 ? 'Run a bot to get live trade data' : ''}
                    >
                        <span className={`analysis__live-dot${completedTrades.length > 0 ? ' analysis__live-dot--on' : ''}`} />
                        Live
                    </button>
                    <button
                        className={`analysis__mode-btn${mode === 'manual' ? ' analysis__mode-btn--active' : ''}`}
                        onClick={() => setMode('manual')}
                    >
                        Manual
                    </button>
                </div>
            </div>

            {mode === 'manual' && (
                <div className='analysis__input-row'>
                    <input
                        className='analysis__input analysis__input--sm'
                        type='number' min='0' step='0.01'
                        value={stake} onChange={e => setStake(e.target.value)}
                        placeholder='Stake'
                    />
                    <input
                        className='analysis__input analysis__input--sm'
                        type='number' min='0' step='0.01'
                        value={payout} onChange={e => setPayout(e.target.value)}
                        placeholder='Payout (on win)'
                    />
                    <button className='analysis__btn analysis__btn--win' onClick={() => addManual('win')}>+ Win</button>
                    <button className='analysis__btn analysis__btn--loss' onClick={() => addManual('loss')}>+ Loss</button>
                    <button className='analysis__btn analysis__btn--secondary' onClick={() => setManualTrades([])}>
                        <Localize i18n_default_text='Clear' />
                    </button>
                </div>
            )}

            <div className='analysis__stats-row'>
                <div className='analysis__stat'>
                    <span className='analysis__stat-value'>
                        {total}
                        {mode === 'live' && completedTrades.length > 0 && (
                            <span className='analysis__live-badge analysis__live-badge--inline'>LIVE</span>
                        )}
                    </span>
                    <span className='analysis__stat-label'><Localize i18n_default_text='Total Trades' /></span>
                </div>
                <div className='analysis__stat'>
                    <span className='analysis__stat-value analysis__stat-value--win'>{wins}</span>
                    <span className='analysis__stat-label'><Localize i18n_default_text='Wins' /></span>
                </div>
                <div className='analysis__stat'>
                    <span className='analysis__stat-value analysis__stat-value--loss'>{losses}</span>
                    <span className='analysis__stat-label'><Localize i18n_default_text='Losses' /></span>
                </div>
                <div className='analysis__stat'>
                    <span className='analysis__stat-value'>{winRate}%</span>
                    <span className='analysis__stat-label'><Localize i18n_default_text='Win Rate' /></span>
                </div>
                <div className='analysis__stat'>
                    <span className={`analysis__stat-value ${netPnL >= 0 ? 'analysis__stat-value--win' : 'analysis__stat-value--loss'}`}>
                        {netPnL >= 0 ? '+' : ''}{netPnL.toFixed(2)}
                    </span>
                    <span className='analysis__stat-label'><Localize i18n_default_text='Net P&L' /></span>
                </div>
            </div>

            {/* Live trade history */}
            {mode === 'live' && recentLive.length > 0 && (
                <div className='analysis__history'>
                    <h4 className='analysis__history-title'><Localize i18n_default_text='Recent Bot Trades' /></h4>
                    <div className='analysis__history-list'>
                        {recentLive.map(t => (
                            <div key={t.id} className={`analysis__history-row analysis__history-row--${t.result}`}>
                                <span className='analysis__history-badge'>{t.result.toUpperCase()}</span>
                                {t.symbol && <span className='analysis__history-symbol'>{t.symbol}</span>}
                                <span>Stake: {t.stake.toFixed(2)}</span>
                                {t.result === 'win' && <span>Payout: {t.payout.toFixed(2)}</span>}
                                <span className={`analysis__history-profit ${t.profit >= 0 ? 'analysis__stat-value--win' : 'analysis__stat-value--loss'}`}>
                                    {t.profit >= 0 ? '+' : ''}{t.profit.toFixed(2)}
                                </span>
                                <span className='analysis__history-time'>{t.timestamp}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Manual trade history */}
            {mode === 'manual' && manualTrades.length > 0 && (
                <div className='analysis__history'>
                    <h4 className='analysis__history-title'><Localize i18n_default_text='Manual Trades' /></h4>
                    <div className='analysis__history-list'>
                        {manualTrades.slice(0, 20).map(t => (
                            <div key={t.id} className={`analysis__history-row analysis__history-row--${t.result}`}>
                                <span className='analysis__history-badge'>{t.result.toUpperCase()}</span>
                                <span>Stake: {t.stake.toFixed(2)}</span>
                                {t.result === 'win' && <span>Payout: {t.payout.toFixed(2)}</span>}
                                <span className='analysis__history-time'>{t.timestamp}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
});

// ─── Stake Calculator ────────────────────────────────────────────────────────

const StakeCalculator = () => {
    const [balance, setBalance] = useState('');
    const [riskPct, setRiskPct] = useState('2');
    const [multiplier, setMultiplier] = useState('2');
    const [steps, setSteps] = useState('5');

    const bal = parseFloat(balance) || 0;
    const risk = parseFloat(riskPct) || 0;
    const mult = parseFloat(multiplier) || 2;
    const numSteps = Math.min(Math.max(parseInt(steps, 10) || 5, 1), 15);
    const baseStake = bal * (risk / 100);

    const martingaleSteps = Array.from({ length: numSteps }, (_, i) => ({
        step: i + 1,
        stake: baseStake * Math.pow(mult, i),
    }));

    return (
        <div className='analysis__tool'>
            <h3 className='analysis__tool-title'>
                <Localize i18n_default_text='Stake Calculator' />
            </h3>
            <p className='analysis__tool-desc'>
                <Localize i18n_default_text='Calculate optimal stake sizes based on your balance and risk tolerance.' />
            </p>
            <div className='analysis__calc-grid'>
                <label className='analysis__label'>
                    <Localize i18n_default_text='Account Balance' />
                    <input className='analysis__input' type='number' min='0' step='0.01' value={balance} onChange={e => setBalance(e.target.value)} placeholder='e.g. 1000' />
                </label>
                <label className='analysis__label'>
                    <Localize i18n_default_text='Risk per trade (%)' />
                    <input className='analysis__input' type='number' min='0.1' max='100' step='0.1' value={riskPct} onChange={e => setRiskPct(e.target.value)} />
                </label>
                <label className='analysis__label'>
                    <Localize i18n_default_text='Martingale multiplier' />
                    <input className='analysis__input' type='number' min='1' step='0.1' value={multiplier} onChange={e => setMultiplier(e.target.value)} />
                </label>
                <label className='analysis__label'>
                    <Localize i18n_default_text='Steps to show' />
                    <input className='analysis__input' type='number' min='1' max='15' step='1' value={steps} onChange={e => setSteps(e.target.value)} />
                </label>
            </div>

            {bal > 0 && (
                <div className='analysis__calc-results'>
                    <p className='analysis__calc-base'>
                        <strong><Localize i18n_default_text='Base stake: ' /></strong>
                        {baseStake.toFixed(2)} ({risk}% of {bal.toFixed(2)})
                    </p>
                    <div className='analysis__steps'>
                        {martingaleSteps.map(({ step, stake }) => (
                            <div key={step} className='analysis__step-row'>
                                <span className='analysis__step-num'>Step {step}</span>
                                <div className='analysis__step-bar-wrap'>
                                    <div
                                        className='analysis__step-bar'
                                        style={{ width: `${Math.min((stake / (baseStake * Math.pow(mult, numSteps - 1))) * 100, 100)}%` }}
                                    />
                                </div>
                                <span className='analysis__step-val'>{stake.toFixed(2)}</span>
                                {stake > bal * 0.5 && <span className='analysis__step-warn'>⚠ &gt;50% balance</span>}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

// ─── Main Analysis Page ──────────────────────────────────────────────────────

type ToolTab = 'digit' | 'tracker' | 'calc';

const AnalysisTools = observer(() => {
    const [activeTab, setActiveTab] = useState<ToolTab>('digit');
    const store = useStore();
    const transactionsStore = store?.transactions;

    // Pull live data from the transactions store.
    // Computed directly (no useMemo) so MobX observer tracks every observable
    // access — including in-place splice updates — and re-renders on any change.
    const rawTransactions: any[] = transactionsStore?.transactions ?? [];
    const completedTrades = getCompleted(rawTransactions);
    const liveDigits = completedTrades
        .map(c => getLastDigitFromTick(c.exit_tick))
        .filter((d): d is number => d !== null);

    const liveStats = transactionsStore?.statistics ?? {
        won_contracts: 0,
        lost_contracts: 0,
        total_profit: 0,
        total_stake: 0,
        total_payout: 0,
        number_of_runs: 0,
    };

    const toolTabs: { id: ToolTab; label: string }[] = [
        { id: 'digit', label: 'Digit Frequency' },
        { id: 'tracker', label: 'Win/Loss Tracker' },
        { id: 'calc', label: 'Stake Calculator' },
    ];

    const hasLiveData = completedTrades.length > 0;

    return (
        <div className='analysis'>
            <div className='analysis__header'>
                <div className='analysis__header-left'>
                    <h2 className='analysis__title'>
                        <Localize i18n_default_text='Risk Calculator' />
                    </h2>
                    <p className='analysis__subtitle'>
                        <Localize i18n_default_text='Study market patterns, track your performance, and plan your staking strategy.' />
                    </p>
                </div>
                {hasLiveData && (
                    <div className='analysis__live-status'>
                        <span className='analysis__live-dot analysis__live-dot--on' />
                        <span>{completedTrades.length} bot trade{completedTrades.length !== 1 ? 's' : ''} loaded</span>
                    </div>
                )}
            </div>

            <div className='analysis__tool-tabs'>
                {toolTabs.map(t => (
                    <button
                        key={t.id}
                        className={`analysis__tool-tab${activeTab === t.id ? ' analysis__tool-tab--active' : ''}`}
                        onClick={() => setActiveTab(t.id)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            <div className='analysis__content'>
                {activeTab === 'digit' && <DigitFrequency liveDigits={liveDigits} />}
                {activeTab === 'tracker' && <WinLossTracker completedTrades={completedTrades} liveStats={liveStats} />}
                {activeTab === 'calc' && <StakeCalculator />}
            </div>
        </div>
    );
});

export default AnalysisTools;
