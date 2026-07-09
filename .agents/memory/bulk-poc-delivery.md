---
name: Bulk purchase POC delivery
description: Why bulk-mode transactions were empty and how the fix works.
---

## The rule
When buying via direct parameters (not a proposal ID), the Deriv API routes the initial `proposal_open_contract` subscription response **only through the Promise** returned by `send()`, NOT through the global `onMessage()` stream.

**Why:** For fast-settling 1-tick contracts (already sold by the time the POC subscription fires), no subsequent messages ever arrive via `onMessage()`. Without a `.then()` handler the initial settled state is silently discarded → `broadcastContract` never called → transactions, stats, journal all stay empty.

**How to apply:** Two coordinated changes were made:

1. `OpenContract.js` — extracted the `observeOpenContract` handler into `processPOCMessage(contract)` with a **duplicate guard** on the bulk settlement path:
   ```js
   if (this.bulkSettledIds.has(contract.contract_id)) return;
   ```
   This prevents `updateTotals` / `contractStatus` firing twice when both the Promise and `onMessage()` deliver the same settled payload.

2. `Purchase.js` `purchaseBulk()` — added `.then()` to each per-contract `send()` call:
   ```js
   .then(response => {
       const contract = response?.proposal_open_contract;
       if (contract) this.processPOCMessage(contract);
   })
   ```
   This handles the case where the initial response is the ONLY delivery path (already-settled contracts).

The `observeOpenContract` onMessage subscriber also calls `processPOCMessage`, so live (not-yet-settled) contracts are still handled correctly through the stream.
