import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { load } from '@/external/bot-skeleton';
import { save_types } from '@/external/bot-skeleton/constants/save-type';
import { useStore } from '@/hooks/useStore';
import { DBOT_TABS } from '@/constants/bot-contents';
import { LabelPairedCircleStarCaptionBoldIcon } from '@deriv/quill-icons/LabelPaired';
import { Localize } from '@deriv-com/translations';
import './free-bots.scss';

type BotCategory = 'Advanced Bots' | 'Premium' | 'Even Odd' | 'Normal' | 'Automated' | 'Differs';

const BOT_CATEGORIES: BotCategory[] = ['Advanced Bots', 'Premium', 'Even Odd', 'Normal', 'Automated', 'Differs'];

const FREE_BOTS = [
    {
        id: 'martingale',
        xml_file: 'martingale',
        name: 'Martingale',
        description: 'Doubles the stake after each loss to recover previous losses with a single win.',
        category: 'Advanced Bots' as BotCategory,
        difficulty: 'Intermediate',
    },
    {
        id: 'dalembert',
        xml_file: 'dalembert',
        name: "D'Alembert",
        description: 'Increases stake by one unit after a loss and decreases by one unit after a win.',
        category: 'Advanced Bots' as BotCategory,
        difficulty: 'Beginner',
    },
    {
        id: 'oscars_grind',
        xml_file: 'oscars_grind',
        name: "Oscar's Grind",
        description: 'A conservative positive progression system aimed at grinding out small profits.',
        category: 'Advanced Bots' as BotCategory,
        difficulty: 'Beginner',
    },
    {
        id: 'reverse_martingale',
        xml_file: 'reverse_martingale',
        name: 'Reverse Martingale',
        description: 'Doubles the stake after each win, capitalising on winning streaks while limiting losses.',
        category: 'Advanced Bots' as BotCategory,
        difficulty: 'Intermediate',
    },
    {
        id: 'reverse_dalembert',
        xml_file: 'reverse_dalembert',
        name: "Reverse D'Alembert",
        description: 'Increases stake by one unit after a win and decreases by one after a loss.',
        category: 'Advanced Bots' as BotCategory,
        difficulty: 'Beginner',
    },
    {
        id: '1_3_2_6',
        xml_file: '1_3_2_6',
        name: '1-3-2-6',
        description: 'A structured stake-progression system following the 1-3-2-6 sequence across consecutive wins.',
        category: 'Advanced Bots' as BotCategory,
        difficulty: 'Advanced',
    },
    {
        id: 'dominator_v2',
        xml_file: 'dominator_v2',
        name: 'Dominator V2',
        description: 'A digit over/under strategy with recovery-digit martingale, take-profit and stop-loss controls.',
        category: 'Premium' as BotCategory,
        difficulty: 'Advanced',
    },
    {
        id: 'frosty_money_maker',
        xml_file: 'frosty_money_maker',
        name: 'Frosty Money Maker (Under)',
        description: 'A digit-under martingale strategy tuned for consistent recovery with configurable profit and loss targets.',
        category: 'Premium' as BotCategory,
        difficulty: 'Advanced',
    },
    {
        id: 'frosty_money_maker_v2',
        xml_file: 'frosty_money_maker_v2',
        name: 'Frosty Money Maker V2 (Over)',
        description: 'A digit-over martingale strategy variant with recovery logic and configurable profit and loss targets.',
        category: 'Premium' as BotCategory,
        difficulty: 'Advanced',
    },
    {
        id: 'frosty_even_odd_engine',
        xml_file: 'frosty_even_odd_engine',
        name: 'Frosty Even/Odd Engine',
        description: 'Trades even/odd digit outcomes with martingale recovery, configurable take-profit and stop-loss targets.',
        category: 'Even Odd' as BotCategory,
        difficulty: 'Advanced',
    },
    {
        id: 'frosty_speed_bot',
        xml_file: 'frosty_speed_bot',
        name: 'Frosty Speed Bot',
        description: 'Fast even/odd digit trading with a "Daily Profit" management system for automatic trade repetition and profit tracking.',
        category: 'Normal' as BotCategory,
        difficulty: 'Intermediate',
    },
    {
        id: 'frosty_dominator',
        xml_file: 'frosty_dominator',
        name: 'Frosty Dominator',
        description: 'A digit over/under strategy with entry-point targeting, recovery-digit martingale, and take-profit/stop-loss controls.',
        category: 'Normal' as BotCategory,
        difficulty: 'Advanced',
    },
    {
        id: 'frosty_version',
        xml_file: 'frosty_version',
        name: 'Frosty Version',
        description: 'A digit over/under prediction strategy with martingale recovery and configurable profit and loss targets.',
        category: 'Normal' as BotCategory,
        difficulty: 'Intermediate',
    },
    {
        id: 'frosty_version_v2',
        xml_file: 'frosty_version_v2',
        name: 'Frosty Version V2',
        description: 'An updated digit over/under strategy variant with martingale recovery and configurable profit and loss targets.',
        category: 'Normal' as BotCategory,
        difficulty: 'Intermediate',
    },
];

const DIFFICULTY_COLORS: Record<string, string> = {
    Beginner: '#10b981',
    Intermediate: '#f59e0b',
    Advanced: '#ef4444',
};

const FreeBots = observer(() => {
    const { dashboard } = useStore();
    const { setActiveTab } = dashboard;
    const [importing, setImporting] = useState<string | null>(null);
    const [activeCategory, setActiveCategory] = useState<BotCategory>('Advanced Bots');

    const handleImport = async (bot: (typeof FREE_BOTS)[number]) => {
        setImporting(bot.id);
        try {
            const xml_module = await import(`../../xml/${bot.xml_file}.xml`);
            const block_string = xml_module.default;
            const workspace = (window as any).Blockly?.derivWorkspace;

            setActiveTab(DBOT_TABS.BOT_BUILDER);

            if (workspace) {
                await load({
                    block_string,
                    workspace,
                    file_name: bot.name,
                    from: save_types.LOCAL,
                    show_snackbar: true,
                });
            } else {
                setTimeout(async () => {
                    const ws = (window as any).Blockly?.derivWorkspace;
                    if (ws) {
                        await load({
                            block_string,
                            workspace: ws,
                            file_name: bot.name,
                            from: save_types.LOCAL,
                            show_snackbar: true,
                        });
                    }
                }, 800);
            }
        } catch (err) {
            console.error('Failed to import bot:', err);
        } finally {
            setImporting(null);
        }
    };

    const bots_in_category = FREE_BOTS.filter(bot => bot.category === activeCategory);

    return (
        <div className='free-bots'>
            <div className='free-bots__header'>
                <h2 className='free-bots__title'>
                    <Localize i18n_default_text='Free Bots' />
                </h2>
                <p className='free-bots__subtitle'>
                    <Localize i18n_default_text='Click "Import to Builder" to load any strategy directly into your Bot Builder workspace.' />
                </p>
            </div>
            <div className='free-bots__category-tabs'>
                {BOT_CATEGORIES.map(category => (
                    <button
                        key={category}
                        className={`free-bots__category-tab${activeCategory === category ? ' free-bots__category-tab--active' : ''}`}
                        onClick={() => setActiveCategory(category)}
                    >
                        {category}
                    </button>
                ))}
            </div>
            {bots_in_category.length > 0 ? (
                <div className='free-bots__grid'>
                    {bots_in_category.map(bot => {
                        const is_loading = importing === bot.id;
                        return (
                            <div key={bot.id} className='free-bots__card'>
                                <div className='free-bots__card-icon'>
                                    <LabelPairedCircleStarCaptionBoldIcon height='32px' width='32px' fill='#f7c53b' />
                                </div>
                                <div className='free-bots__card-body'>
                                    <div className='free-bots__card-top'>
                                        <span className='free-bots__card-category'>{bot.category}</span>
                                        <span
                                            className='free-bots__card-difficulty'
                                            style={{ color: DIFFICULTY_COLORS[bot.difficulty] }}
                                        >
                                            {bot.difficulty}
                                        </span>
                                    </div>
                                    <h3 className='free-bots__card-name'>{bot.name}</h3>
                                    <p className='free-bots__card-description'>{bot.description}</p>
                                </div>
                                <button
                                    className={`free-bots__card-btn${is_loading ? ' free-bots__card-btn--loading' : ''}`}
                                    onClick={() => handleImport(bot)}
                                    disabled={is_loading}
                                >
                                    {is_loading ? (
                                        <Localize i18n_default_text='Importing…' />
                                    ) : (
                                        <Localize i18n_default_text='Import to Builder' />
                                    )}
                                </button>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className='free-bots__empty'>
                    <Localize i18n_default_text='No bots in this category yet. Check back soon!' />
                </div>
            )}
        </div>
    );
});

export default FreeBots;
