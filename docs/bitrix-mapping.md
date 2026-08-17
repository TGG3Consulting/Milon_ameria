# Bitrix Mapping

The app uses Bitrix24 as the main storage and reads all operational data from Bitrix.

## Smart Processes

- `1056` - Bank payment receipts, category `35`
- `1052` - Payment schedule, category `33`
- `parentId2` - Deal relation for schedule items and matched receipts
- Deals are read from category `5`
- Deal field `UF_CRM_1785744431` stores linked receipt IDs and must be appended to, not overwritten
- Receipt field `contactId` stores the matched deal contact

## Receipt Fields `1056`

- `xmlId` - bank transaction id, used for duplicate prevention
- `stageId`
  - `DT1056_35:NEW` - unmatched/new receipt
  - `DT1056_35:PREPARATION` - matched receipt
- `ufCrm19_1785737436` - payer name
- `ufCrm19_1785737603` - beneficiary name
- `ufCrm19_1785737375` - paid amount
- `ufCrm19_1785736747` - payment date
- `ufCrm19_1785737270` - currency enum
- `ufCrm19_1785738531` - payment purpose
- `ufCrm19_1785736905` - debit
- `ufCrm19_1785737256` - credit
- `ufCrm19_1785737495` - payer document
- `ufCrm19_1785737544` - payer address
- `ufCrm19_1785738501` - amount in words
- currency enum values:
  - `1651` - AMD
  - `1653` - USD
  - `1655` - RUB
  - `1657` - EUR

## Schedule Fields `1052`

- `stageId` - resolved at runtime from `crm.status.list` by status element id (`491` unpaid, `493` partially paid, `495` paid), with these fallbacks:
  - `DT1052_33:NEW` - unpaid
  - `DT1052_33:PREPARATION` - partially paid
  - `DT1052_33:SUCCESS` - paid (`DYNAMIC_1052_STAGE_33` is the status `ENTITY_ID`, not a stage id)
- `parentId2` - linked deal id
- `opportunity` - schedule amount
- `currencyId` - currency
- `ufCrm17_1784111700810` - payer first name
- `ufCrm17_1784111710154` - payer last name
- `ufCrm17_1784111720716` - payer middle name
- `ufCrm17_1784111873449` - payment date
- `ufCrm17_1785747159082` - partially paid amount
- `ufCrm17_1785747288489` - remaining amount

## Flow

1. Bank transaction arrives.
2. Backend checks `1056` by `xmlId` to prevent duplicates.
3. If not found, backend creates a new `1056` item in `DT1056_35:NEW`.
4. UI reads receipts from `1056`.
5. UI reads payment schedules from `1052`, contacts, and category `5` deals to build suggestions.
6. On confirm, backend updates:
   - `1056.stageId` to `DT1056_35:PREPARATION`
   - `1056.parentId2` to selected Deal ID
   - `1056.contactId` to the selected deal contact
   - selected Deal `UF_CRM_1785744431` by appending the new receipt ID
   - `1052` schedules by recalculating paid, partially paid, and remaining amounts from AMD receipts

## Ameriabank Sync

Cron should call `POST /api/ameria/sync`. The server pulls transactions from `AMERIA_TRANSACTIONS_PATH`, creates only missing Bitrix `1056` receipt items, and returns the imported Bitrix items.
