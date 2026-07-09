import { LogTypes } from '../../../constants/messages';
import { api_base } from '../../api/api-base';
import { contractStatus, info, log } from '../utils/broadcast';
import { doUntilDone, getUUID, recoverFromError, tradeOptionToBuy } from '../utils/helpers';
import { purchaseSuccessful } from './state/actions';
import { BEFORE_PURCHASE } from './state/constants';

let delayIndex = 0;
let purchase_reference;

export default Engine =>
    class Purchase extends Engine {
        purchase(contract_type) {
            // Prevent calling purchase twice
            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                return Promise.resolve();
            }

            const onSuccess = response => {
                // Don't unnecessarily send a forget request for a purchased contract.
                const { buy } = response;

                contractStatus({
                    id: 'contract.purchase_received',
                    data: buy.transaction_id,
                    buy,
                });

                this.contractId = buy.contract_id;
                this.store.dispatch(purchaseSuccessful());

                if (this.is_proposal_subscription_required) {
                    this.renewProposalsOnPurchase();
                }

                delayIndex = 0;
                log(LogTypes.PURCHASE, { transaction_id: buy.transaction_id });
                info({
                    accountID: this.accountInfo.loginid,
                    totalRuns: this.updateAndReturnTotalRuns(),
                    transaction_ids: { buy: buy.transaction_id },
                    contract_type,
                    buy_price: buy.buy_price,
                });
            };

            if (this.is_proposal_subscription_required) {
                const { id, askPrice } = this.selectProposal(contract_type);

                const action = () => api_base.api.send({ buy: id, price: askPrice });

                this.isSold = false;

                contractStatus({
                    id: 'contract.purchase_sent',
                    data: askPrice,
                });

                if (!this.options.timeMachineEnabled) {
                    return doUntilDone(action).then(onSuccess);
                }

                return recoverFromError(
                    action,
                    (errorCode, makeDelay) => {
                        // if disconnected no need to resubscription (handled by live-api)
                        if (errorCode !== 'DisconnectError') {
                            this.renewProposalsOnPurchase();
                        } else {
                            this.clearProposals();
                        }

                        const unsubscribe = this.store.subscribe(() => {
                            const { scope, proposalsReady } = this.store.getState();
                            if (scope === BEFORE_PURCHASE && proposalsReady) {
                                makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                                unsubscribe();
                            }
                        });
                    },
                    ['PriceMoved', 'InvalidContractProposal'],
                    delayIndex++
                ).then(onSuccess);
            }
            const trade_option = tradeOptionToBuy(contract_type, this.tradeOptions);
            const action = () => api_base.api.send(trade_option);

            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_sent',
                data: this.tradeOptions.amount,
            });

            if (!this.options.timeMachineEnabled) {
                return doUntilDone(action).then(onSuccess);
            }

            return recoverFromError(
                action,
                (errorCode, makeDelay) => {
                    if (errorCode === 'DisconnectError') {
                        this.clearProposals();
                    }
                    const unsubscribe = this.store.subscribe(() => {
                        const { scope } = this.store.getState();
                        if (scope === BEFORE_PURCHASE) {
                            makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                            unsubscribe();
                        }
                    });
                },
                ['PriceMoved', 'InvalidContractProposal'],
                delayIndex++
            ).then(onSuccess);
        }

        // ── Bulk Purchase ──────────────────────────────────────────────────────
        purchaseBulk(contract_type, count = 2) {
            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                return Promise.resolve();
            }

            // Clamp count to a sane range
            const n = Math.max(2, Math.min(50, Math.round(count)));

            // Reset bulk tracking state
            this.bulkContractIds = [];
            this.bulkTotalCount  = n;
            this.bulkSettledCount = 0;
            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_sent',
                data: this.tradeOptions.amount,
            });

            const trade_option = tradeOptionToBuy(contract_type, this.tradeOptions);

            // NOTE: Do NOT add subscribe: 1 to the buy request.
            // The Deriv API only honours subscribe on proposal-ID buys, not on
            // parameter-based direct buys.  We subscribe explicitly via
            // proposal_open_contract after the contracts are confirmed (below).
            const buy_option = { ...trade_option };

            // Fire N buy requests in parallel before scope transition
            const buys = Array.from({ length: n }, () =>
                doUntilDone(() => api_base.api.send(buy_option))
            );

            // Use allSettled so a partial failure doesn't abort contract tracking
            return Promise.allSettled(buys).then(results => {
                results.forEach(result => {
                    if (result.status !== 'fulfilled') {
                        // Log individual buy failure but continue tracking the rest
                        console.warn('[BulkPurchase] one buy failed:', result.reason);
                        return;
                    }
                    const { buy } = result.value;
                    this.bulkContractIds.push(buy.contract_id);

                    contractStatus({
                        id: 'contract.purchase_received',
                        data: buy.transaction_id,
                        buy,
                    });

                    log(LogTypes.PURCHASE, { transaction_id: buy.transaction_id });
                    info({
                        accountID: this.accountInfo.loginid,
                        totalRuns: this.updateAndReturnTotalRuns(),
                        transaction_ids: { buy: buy.transaction_id },
                        contract_type,
                        buy_price: buy.buy_price,
                    });
                });

                delayIndex = 0;

                if (this.bulkContractIds.length === 0) {
                    // Every buy failed — reset state so engine can recover
                    this.bulkTotalCount  = 0;
                    this.bulkSettledCount = 0;
                    throw new Error('BulkPurchaseFailed: all buy requests failed');
                }

                // Update the expected settled count to only the contracts we actually bought
                this.bulkTotalCount = this.bulkContractIds.length;

                // Transition scope once — after all successful buys are registered
                this.store.dispatch(purchaseSuccessful());

                // Renew proposal subscriptions so the next trade cycle gets fresh prices.
                if (this.is_proposal_subscription_required) {
                    this.renewProposalsOnPurchase();
                }

                // Explicitly subscribe to proposal_open_contract for each bought contract.
                //
                // The Deriv API routes the initial subscription response ONLY through the
                // Promise returned by send() — NOT through the global onMessage() stream —
                // when the contract is already settled by the time we subscribe (common for
                // fast 1-tick options on volatility indices).  Without a .then() handler the
                // initial settled state is silently discarded, so broadcastContract /
                // updateTotals are never called and transactions/stats remain empty.
                //
                // processPOCMessage() contains a duplicate-guard (bulkSettledIds.has())
                // so calling it from here AND from observeOpenContract's onMessage() stream
                // (for contracts that come through both paths) is safe — updateTotals and
                // contractStatus fire exactly once per settled contract.
                this.bulkContractIds.forEach(contract_id => {
                    api_base.api
                        .send({ proposal_open_contract: 1, contract_id, subscribe: 1 })
                        .then(response => {
                            // Process the initial contract state returned by the subscription.
                            // For already-settled contracts this may be the ONLY delivery path.
                            const contract = response?.proposal_open_contract;
                            if (contract) {
                                this.processPOCMessage(contract);
                            }
                        })
                        .catch(err => {
                            console.warn('[BulkPurchase] POC subscription failed for', contract_id, err);
                        });
                });
            });
        }

        getPurchaseReference = () => purchase_reference;
        regeneratePurchaseReference = () => {
            purchase_reference = getUUID();
        };
    };
