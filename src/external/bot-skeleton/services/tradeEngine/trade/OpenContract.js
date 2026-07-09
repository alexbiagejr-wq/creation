import { getRoundedNumber } from '@/components/shared';
import { api_base } from '../../api/api-base';
import { contract as broadcastContract, contractStatus } from '../utils/broadcast';
import { openContractReceived, sell } from './state/actions';
import { NEW_TICK } from './state/constants';

export default Engine =>
    class OpenContract extends Engine {
        /**
         * Process a single proposal_open_contract payload.
         *
         * Called from two places:
         *  1. observeOpenContract's onMessage() stream  — covers normal + bulk live updates.
         *  2. purchaseBulk()'s per-contract send().then() — covers the initial subscription
         *     response that the Deriv API routes ONLY through the Promise, not through
         *     onMessage().  Without this second call path, already-settled fast contracts
         *     (e.g. 1-tick options) are never broadcast and transactions stay empty.
         *
         * A duplicate-guard on the bulk settlement path ensures updateTotals / contractStatus
         * fire exactly once even when both paths deliver the same "is_sold" payload.
         */
        processPOCMessage(contract) {
            if (!contract || !this.expectedContractId(contract?.contract_id)) {
                return;
            }

            this.setContractFlags(contract);

            this.data.contract = contract;

            const is_bulk =
                this.bulkContractIds &&
                this.bulkContractIds.length > 0 &&
                this.bulkContractIds.includes(contract.contract_id);

            broadcastContract({ accountID: api_base.account_info.loginid, ...contract, is_bulk: Boolean(is_bulk) });

            const is_sold = Boolean(contract.is_sold);

            if (is_sold) {
                // ── Bulk mode ─────────────────────────────────────────────────────
                if (this.bulkContractIds && this.bulkContractIds.length > 0) {
                    if (!this.bulkSettledIds) this.bulkSettledIds = new Set();

                    // Duplicate guard: both the send() Promise AND onMessage() can deliver
                    // the same settled payload.  Only process each contract's settlement once.
                    if (this.bulkSettledIds.has(contract.contract_id)) {
                        return;
                    }

                    this.bulkSettledIds.add(contract.contract_id);

                    clearTimeout(this.transaction_recovery_timeout);
                    this.updateTotals(contract);
                    contractStatus({
                        id: 'contract.sold',
                        data: contract.transaction_ids.sell,
                        contract,
                    });

                    // Only advance engine once ALL bulk contracts have settled
                    if (this.bulkSettledIds.size >= this.bulkContractIds.length) {
                        this.bulkContractIds  = [];
                        this.bulkSettledIds   = new Set();
                        this.bulkTotalCount   = 0;
                        this.bulkSettledCount = 0;
                        this.contractId       = '';

                        if (this.afterPromise) {
                            this.afterPromise();
                        }

                        // Dispatch sell() first to move scope to STOP, then
                        // dispatch a synthetic NEW_TICK to unblock the watchDuring
                        // tick gate.  Without this, watchDuring can only resolve on
                        // the next real market tick — which can take 1-2 seconds and
                        // makes the bot appear to hang after bulk trades.
                        this.store.dispatch(sell());
                        this.store.dispatch({ type: NEW_TICK, payload: Date.now() + Math.random() });
                    }
                } else {
                    // ── Single-contract (normal) mode ────────────────────────────
                    this.contractId = '';
                    clearTimeout(this.transaction_recovery_timeout);
                    this.updateTotals(contract);
                    contractStatus({
                        id: 'contract.sold',
                        data: contract.transaction_ids.sell,
                        contract,
                    });

                    if (this.afterPromise) {
                        this.afterPromise();
                    }

                    this.store.dispatch(sell());
                }
            } else {
                this.store.dispatch(openContractReceived());
            }
        }

        observeOpenContract() {
            if (!api_base.api) return;
            const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                if (data.msg_type === 'proposal_open_contract') {
                    this.processPOCMessage(data.proposal_open_contract);
                }
            });
            api_base.pushSubscription(subscription);
        }

        waitForAfter() {
            return new Promise(resolve => {
                this.afterPromise = resolve;
            });
        }

        setContractFlags(contract) {
            const { is_expired, is_valid_to_sell, is_sold, entry_tick } = contract;

            // In bulk mode isSold is tracked per-contract via bulkSettledIds
            if (!this.bulkContractIds || this.bulkContractIds.length === 0) {
                this.isSold = Boolean(is_sold);
            }
            this.isSellAvailable = !Boolean(is_sold) && Boolean(is_valid_to_sell);
            this.isExpired       = Boolean(is_expired);
            this.hasEntryTick    = Boolean(entry_tick);
        }

        expectedContractId(contractId) {
            // Bulk mode: accept any of the tracked bulk contract IDs
            if (this.bulkContractIds && this.bulkContractIds.length > 0) {
                return this.bulkContractIds.includes(contractId);
            }
            return this.contractId && contractId === this.contractId;
        }

        getSellPrice() {
            const { bid_price: bidPrice, buy_price: buyPrice, currency } = this.data.contract;
            return getRoundedNumber(Number(bidPrice) - Number(buyPrice), currency);
        }
    };
