import { addActivity, getActivityLog } from './activityStore.js';
import { callBitrixMethod, listBitrixMethod } from './bitrixClient.js';
import { normalizeBankTransaction } from './transactionValidation.js';

const TYPES = {
  voucher: {
    entityTypeId: 1056,
    categoryId: 35,
    stages: {
      new: 'DT1056_35:NEW',
      matched: 'DT1056_35:PREPARATION'
    },
    fields: {
      payerName: 'ufCrm19_1785737436',
      beneficiaryName: 'ufCrm19_1785737603',
      amount: 'ufCrm19_1785737375',
      paymentDate: 'ufCrm19_1785736747',
      currencyEnum: 'ufCrm19_1785737270',
      purpose: 'ufCrm19_1785738531',
      debit: 'ufCrm19_1785736905',
      credit: 'ufCrm19_1785737256',
      payerDocument: 'ufCrm19_1785737495',
      payerAddress: 'ufCrm19_1785737544',
      amountWords: 'ufCrm19_1785738501'
    }
  },
  schedule: {
    entityTypeId: 1052,
    categoryId: 33,
    stages: {
      unpaid: 'DT1052_33:NEW',
      partial: 'DT1052_33:PREPARATION',
      paid: 'DT1052_33:SUCCESS'
    },
    fields: {
      firstName: 'ufCrm17_1784111700810',
      lastName: 'ufCrm17_1784111710154',
      middleName: 'ufCrm17_1784111720716',
      paymentDate: 'ufCrm17_1784111873449',
      advancePaid: 'ufCrm17_1785054336',
      partialPaid: 'ufCrm17_1785747159082',
      remaining: 'ufCrm17_1785747288489'
    }
  }
};

const DEAL_SELECT = [
  'ID',
  'TITLE',
  'CATEGORY_ID',
  'CONTACT_ID',
  'OPPORTUNITY',
  'CURRENCY_ID',
  'UF_CRM_1716720255166',
  'UF_*'
];
const DEAL_FIELDS = {
  categoryId: 'CATEGORY_ID',
  contactId: 'CONTACT_ID',
  receiptIds: 'UF_CRM_1785744431',
  buyerName: 'UF_CRM_1716720255166',
  apartmentChecked: 'UF_CRM_1776254518',
  apartmentNumber: 'UF_CRM_65BE4878488D4',
  floor: 'UF_CRM_1686473759',
  area: 'UF_CRM_1686299562903',
  project: 'UF_CRM_1778739784729',
  buildingSection: 'UF_CRM_1779963968563'
};
const CONTACT_FIELDS = {
  documentNumber: 'UF_CRM_1688399117351'
};
const CURRENCY_ENUM = {
  AMD: 1651,
  USD: 1653,
  RUB: 1655,
  EUR: 1657
};
const BUILDING_OPTIONS = [
  { label: 'Milon Tower', value: '1507' },
  { label: 'Milon Plaza', value: '1505' },
  { label: 'Milon Hills', value: '1503' }
];
const STATUS_ENTITY_IDS = {
  voucher: 'DYNAMIC_1056_35',
  schedule: 'DYNAMIC_1052_STAGE_33'
};
const STATUS_ELEMENT_IDS = {
  voucher: { new: 517, matched: 519 },
  schedule: { unpaid: 491, partial: 493, paid: 495 }
};
const DOCUMENT_PREFIX_LENGTH = 9;
const MIN_DOCUMENT_PREFIX_LENGTH = 6;
const MAX_CONTACT_LOOKUPS = 25;
const CONTACT_MATCH_SCORE = 110;
const receiptImportLocks = new Map();
let stagesPromise = null;

// Payment purposes arrive from several banks and are commonly typed with compact Armenian,
// Russian, English, and transliterated abbreviations. Keep every field independent so forms
// such as `bn48` and `48bn` cannot swap the apartment and building capture groups.
const PURPOSE_PATTERNS = {
  building: [
    /(?<![\p{L}\p{N}])(?:շենք|շնք|շ\.|շենքի|дом|корпус|building|bldg?\.?|shenk|sh\.)\s*(?:թիվ|համար|№|#|n(?:o)?\.?)?\s*[-:]?\s*(\d{1,4})(?!\d)/iu,
    /(?<!\d)(\d{1,4})\s*(?:-?րդ)?\s*[-:]?\s*(?:շենք|շնք|շ\.|շենքի|дом|корпус|building|bldg?\.?|shenk|sh\.)(?![\p{L}\p{N}])/iu
  ],
  apartment: [
    /(?<![\p{L}\p{N}])(?:բնակարան|բնակ\.?|բն\.?|բ\.|կվ\.?|кв\.?|квартира|apt\.?|apartment|flat|bn\.?)\s*(?:թիվ|համար|№|#|n(?:o)?\.?)?\s*[-:]?\s*(\d{1,4}(?:[/-]\d{1,3})?[a-zա-ֆ]?)(?![\p{L}\p{N}])/iu,
    /(?<![\p{L}\p{N}])(\d{1,4}(?:[/-]\d{1,3})?[a-zա-ֆ]?)\s*(?:-?րդ)?\s*[-:]?\s*(?:բնակարան|բնակ\.?|բն\.?|բ\.|կվ\.?|кв\.?|квартира|apt\.?|apartment|flat|bn\.?)(?![\p{L}\p{N}])/iu
  ],
  entrance: [
    /(?<![\p{L}\p{N}])(?:մուտք|մտք\.?|entrance|entry|подъезд)\s*(?:թիվ|համար|№|#|n(?:o)?\.?)?\s*[-:]?\s*(\d{1,2})(?!\d)/iu,
    /(?<!\d)(\d{1,2})\s*(?:-?րդ)?\s*[-:]?\s*(?:մուտք|մտք\.?|entrance|entry|подъезд)(?![\p{L}\p{N}])/iu
  ],
  floor: [
    /(?<![\p{L}\p{N}])(?:հարկ|հրկ\.?|floor|fl\.?|этаж)\s*(?:թիվ|համար|№|#|n(?:o)?\.?)?\s*[-:]?\s*(-?\d{1,2})(?!\d)/iu,
    /(?<!\d)(-?\d{1,2})\s*(?:-?րդ)?\s*[-:]?\s*(?:հարկ|հրկ\.?|floor|fl\.?|этаж)(?![\p{L}\p{N}])/iu
  ],
  preliminaryNumber: [
    /(?<![\p{L}\p{N}])(?:նախ(?:նական)?\.?\s*(?:համար|համ\.?|հ\.?)|preliminary\s*(?:no\.?)?|նախահամար)\s*[:#№-]?\s*(\d{1,6}(?:[.,/-]\d{1,4})?)/iu
  ],
  registrationNumber: [
    /(?<![\p{L}\p{N}])(?:գրանց(?:ման)?\.?\s*(?:համար|համ\.?|հ\.?)?|registration\s*(?:no\.?)?|reg\.?\s*(?:no\.?)?)\s*[:#№-]?\s*([\p{L}\d]+(?:[/-][\p{L}\d]+)*)/iu
  ],
  area: [
    /(?<![\p{L}\p{N}])(?:մակ\.?|մակերես|area|square)\s*[:#-]?\s*(\d{1,4}(?:[.,]\d{1,2})?)(?:\s*(?:քմ|մ²|m²|sq\.?\s*m))?/iu,
    /(?<![\p{L}\p{N}])(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:քմ|մ²|m²|sq\.?\s*m)(?![\p{L}\p{N}])/iu
  ],
  contractDate: [
    /(?<!\d)(\d{1,2}[./-]\d{1,2}[./-]\d{4})(?![./-]?\d)/u,
    /(?<!\d)(\d{4}-\d{1,2}-\d{1,2})(?!\d)/u
  ],
  addressNumber: [
    /(?<![\p{L}\p{N}])(?:հասցե|փողոց|պողոտա|տուն|address|street|st\.?)\s*(?:թիվ|համար|№|#|n(?:o)?\.?)?\s*[-:]?\s*(\d{1,4}\/\d{1,3})(?![./-]?\d)/iu,
    /(?<![\p{L}\p{N}])(\d{1,4}\/\d{1,3})\s*(?:հասցե|փողոց|պողոտա|տուն|address|street|st\.?)(?![\p{L}\p{N}])/iu,
    /(?<![\d./-])(\d{1,4}\/\d{1,3})(?![\d./-])/u
  ]
};

const PROJECT_PATTERNS = [
  { name: 'Milon Tower', pattern: /(?<!\p{L})(?:milon\s*tower|միլոն\s*թաուեր|միլոն\s*տաուեր)(?!\p{L})/iu },
  { name: 'Milon Plaza', pattern: /(?<!\p{L})(?:milon\s*plaza|միլոն\s*պլազա)(?!\p{L})/iu },
  { name: 'Milon Hills', pattern: /(?<!\p{L})(?:milon\s*hills|միլոն\s*հիլս)(?!\p{L})/iu }
];

export function resetStageCache() {
  stagesPromise = null;
}

async function getStages() {
  stagesPromise ??= loadStages();
  return stagesPromise;
}

async function loadStages() {
  const stages = getDefaultStages();

  try {
    const statuses = await listBitrixMethod('crm.status.list', {
      filter: { '@ENTITY_ID': Object.values(STATUS_ENTITY_IDS) },
      order: { SORT: 'ASC' }
    });
    const statusIdByElementId = new Map(statuses.map((status) => [String(status.ID), status.STATUS_ID]));

    for (const [type, elementIds] of Object.entries(STATUS_ELEMENT_IDS)) {
      for (const [key, elementId] of Object.entries(elementIds)) {
        const statusId = statusIdByElementId.get(String(elementId));

        if (statusId) {
          stages[type][key] = statusId;
        }
      }
    }
  } catch {
    // Bitrix unreachable or crm.status.list is not permitted: fall back to the documented stage ids
  }

  return stages;
}

export function parsePurpose(purpose = '') {
  const normalized = normalize(purpose);
  const contractDate = matchFirst(normalized, PURPOSE_PATTERNS.contractDate);
  const withoutDates = maskMatches(normalized, PURPOSE_PATTERNS.contractDate);
  const project = PROJECT_PATTERNS.find(({ pattern }) => pattern.test(normalized)) ?? null;
  const projectBuilding = matchFirst(normalized, [
    /(?<!\d)(\d{1,4})\s*(?:milon\s*tower|միլոն\s*թաուեր|միլոն\s*տաուեր)(?![\p{L}\p{N}])/iu,
    /(?<![\p{L}\p{N}])(?:milon\s*tower|միլոն\s*թաուեր|միլոն\s*տաուեր)\s*(?:շենք|building|bldg?\.?)?\s*(?:թիվ|№|#|n(?:o)?\.?)?\s*(\d{1,4})(?!\d)/iu
  ]);
  const building = matchFirst(normalized, PURPOSE_PATTERNS.building);
  const apartment = matchFirst(normalized, PURPOSE_PATTERNS.apartment);
  const withoutDatesOrApartments = maskMatches(withoutDates, PURPOSE_PATTERNS.apartment);
  const addressNumber = matchFirst(withoutDatesOrApartments, PURPOSE_PATTERNS.addressNumber);
  const entrance = matchFirst(normalized, PURPOSE_PATTERNS.entrance);
  const floor = matchFirst(normalized, PURPOSE_PATTERNS.floor);
  const preliminaryNumber = matchFirst(normalized, PURPOSE_PATTERNS.preliminaryNumber);
  const registrationNumber = matchFirst(normalized, PURPOSE_PATTERNS.registrationNumber);
  const area = matchFirst(withoutDates, PURPOSE_PATTERNS.area);

  return {
    normalized,
    building: building?.[1] ?? projectBuilding?.[1] ?? null,
    apartment: apartment?.[1] ?? preliminaryNumber?.[1] ?? null,
    addressNumber: addressNumber?.[1] ?? null,
    entrance: entrance?.[1] ?? null,
    floor: floor?.[1] ?? null,
    preliminaryNumber: preliminaryNumber?.[1] ?? null,
    registrationNumber: registrationNumber?.[1] ?? null,
    contractDate: contractDate?.[1] ?? null,
    area: area?.[1]?.replace(',', '.') ?? null,
    project: project?.name ?? null
  };
}

export async function listReceipts() {
  const [stages, voucherResponse] = await Promise.all([getStages(), listBitrixVouchers()]);

  if (!voucherResponse.items.length) {
    return {
      unmatched: [],
      matched: [],
      log: await getActivityLog()
    };
  }

  const [scheduleResponse, deals] = await Promise.all([listBitrixSchedules(), listRecentDeals()]);
  const rawSchedules = scheduleResponse.items.map(mapSchedule);
  const dealById = new Map(deals.map((deal) => [deal.id, deal]));
  const schedules = rawSchedules.map((schedule) => ({
    ...schedule,
    deal: dealById.get(schedule.dealId) ?? null
  }));
  const receipts = voucherResponse.items.map((item) => mapVoucherData(item, stages));
  const contactDealsByDocument = await loadContactDealsByDocument(receipts, deals);
  const suggestionContext = { deals, contactDealsByDocument, stages };
  const vouchers = receipts.map((receipt) => ({
    ...receipt,
    suggestions: receipt.status === 'unmatched' ? getSuggestions(receipt, schedules, suggestionContext) : []
  }));

  return {
    unmatched: vouchers.filter((receipt) => receipt.status === 'unmatched'),
    matched: vouchers.filter((receipt) => receipt.status === 'matched'),
    log: await getActivityLog()
  };
}

export async function importBankTransaction(input) {
  const transaction = normalizeBankTransaction(input);
  const transactionId = transaction.transactionId;

  if (receiptImportLocks.has(transactionId)) {
    return receiptImportLocks.get(transactionId).then((result) => ({ ...result, created: false }));
  }

  const importPromise = createBankReceiptOnce(transaction).finally(() => {
    receiptImportLocks.delete(transactionId);
  });
  receiptImportLocks.set(transactionId, importPromise);
  return importPromise;
}

export async function createBankReceipt(input) {
  return (await importBankTransaction(input)).receipt;
}

async function createBankReceiptOnce(transaction) {
  const [stages, existingReceipt] = await Promise.all([
    getStages(),
    findVoucherByExternalId(transaction.transactionId)
  ]);

  if (existingReceipt) {
    return { receipt: existingReceipt, created: false };
  }

  const fields = mapBankTransactionToVoucherFields(transaction, stages);
  const result = await callBitrixMethod('crm.item.add', {
    entityTypeId: TYPES.voucher.entityTypeId,
    fields
  });

  const receipt = result.item ?? result;
  await addActivity({
    receiptId: result.item?.id ?? result.item?.ID ?? 'new',
    action: 'Bank receipt was created in Bitrix',
    actor: 'System'
  });

  return { receipt, created: true };
}

export async function searchDeals({ name = '', building = '', apartment = '' }) {
  const deals = await listRecentDeals();
  const queryName = normalize(name);
  const queryNameAlt = normalize(transliterateLatinToArmenian(name));
  const queryBuilding = String(building ?? '').trim();
  const queryApartment = normalizeNumber(apartment);

  return deals.filter((deal) => {
    const haystack = deal.searchableText;
    const tokens = getNumberTokens(haystack);
    const byName = !queryName || includesText(haystack, queryName) || (queryNameAlt && includesText(haystack, queryNameAlt));
    const byBuilding = !queryBuilding || deal.projectId === queryBuilding;
    const byApartment = !queryApartment || tokens.has(queryApartment) || includesText(haystack, queryApartment);

    return byName && byBuilding && byApartment;
  });
}

export async function listBuildingOptions() {
  return BUILDING_OPTIONS;
}

export async function confirmMatch({ receiptId, dealId, scheduleIds = [] }) {
  const [stages, deal, receipt] = await Promise.all([
    getStages(),
    getBitrixDeal(dealId),
    getBitrixVoucher(receiptId)
  ]);
  assertMatchEntities({ deal, receipt, dealId, stages });
  await validateSelectedSchedules(scheduleIds, dealId, stages);

  const contactId = getDealContactId(deal);
  const previousReceiptIds = deal?.[DEAL_FIELDS.receiptIds] ?? [];
  const receiptIds = appendUniqueId(deal?.[DEAL_FIELDS.receiptIds], receiptId);
  let dealUpdated = false;
  let receiptUpdated = false;

  try {
    await callBitrixMethod('crm.deal.update', {
      id: dealId,
      fields: {
        [DEAL_FIELDS.receiptIds]: receiptIds
      }
    });
    dealUpdated = true;

    await callBitrixMethod('crm.item.update', {
      entityTypeId: TYPES.voucher.entityTypeId,
      id: receiptId,
      fields: {
        stageId: stages.voucher.matched,
        parentId2: dealId,
        ...(contactId ? { contactId } : {})
      }
    });
    receiptUpdated = true;

    const recalculation = await recalculateDealSchedules(dealId, stages, receiptIds);
    await addActivity({
      receiptId,
      action: `Receipt matched with Deal #${dealId}; schedules recalculated`,
      actor: 'Manager'
    });

    return {
      id: receiptId,
      matchedDealId: dealId,
      matchedScheduleIds: scheduleIds,
      recalculation
    };
  } catch (error) {
    const rollbackErrors = [];

    if (receiptUpdated) {
      await callBitrixMethod('crm.item.update', {
        entityTypeId: TYPES.voucher.entityTypeId,
        id: receiptId,
        fields: {
          stageId: receipt.stageId,
          parentId2: receipt.parentId2 ?? null,
          contactId: receipt.contactId ?? null
        }
      }).catch((rollbackError) => rollbackErrors.push(rollbackError));
    }
    if (dealUpdated) {
      await callBitrixMethod('crm.deal.update', {
        id: dealId,
        fields: { [DEAL_FIELDS.receiptIds]: previousReceiptIds }
      }).catch((rollbackError) => rollbackErrors.push(rollbackError));
    }

    if (rollbackErrors.length) {
      error.message = `${error.message}; rollback failed: ${rollbackErrors.map((item) => item.message).join('; ')}`;
    }
    throw error;
  }
}

async function listBitrixVouchers() {
  const items = await listBitrixMethod('crm.item.list', {
    entityTypeId: TYPES.voucher.entityTypeId,
    order: { id: 'DESC' },
    filter: {
      categoryId: TYPES.voucher.categoryId
    },
    select: [
      'id',
      'title',
      'xmlId',
      'stageId',
      'parentId2',
      'opportunity',
      'currencyId',
      'createdTime',
      'updatedTime',
      TYPES.voucher.fields.payerName,
      TYPES.voucher.fields.amount,
      TYPES.voucher.fields.paymentDate,
      TYPES.voucher.fields.currencyEnum,
      TYPES.voucher.fields.purpose,
      TYPES.voucher.fields.payerDocument,
      TYPES.voucher.fields.payerAddress
    ]
  });
  return { items };
}

async function listBitrixSchedules() {
  const items = await listBitrixMethod('crm.item.list', {
    entityTypeId: TYPES.schedule.entityTypeId,
    order: { id: 'ASC' },
    filter: {
      categoryId: TYPES.schedule.categoryId
    },
    select: [
      'id',
      'title',
      'stageId',
      'parentId2',
      'opportunity',
      'currencyId',
      TYPES.schedule.fields.firstName,
      TYPES.schedule.fields.lastName,
      TYPES.schedule.fields.middleName,
      TYPES.schedule.fields.paymentDate,
      TYPES.schedule.fields.partialPaid,
      TYPES.schedule.fields.remaining
    ]
  });
  return { items };
}

function mapVoucherData(item, stages) {
  const amount = Number(item[TYPES.voucher.fields.amount] ?? item.opportunity ?? 0);
  const purpose = item[TYPES.voucher.fields.purpose] ?? '';
  return {
    id: String(item.id),
    bankTransactionId: item.xmlId || String(item.id),
    bitrixTitle: item.title,
    amount,
    currency: item.currencyId || 'AMD',
    currencyEnum: Number(item[TYPES.voucher.fields.currencyEnum] ?? 0) || null,
    payerName: item[TYPES.voucher.fields.payerName] ?? '',
    payerDocument: item[TYPES.voucher.fields.payerDocument] ?? '',
    purpose,
    receivedAt: item.createdTime,
    paymentDate: item[TYPES.voucher.fields.paymentDate],
    status: item.stageId === stages.voucher.new ? 'unmatched' : 'matched',
    matchedDealId: item.parentId2 ? String(item.parentId2) : null,
    parsed: parsePurpose(purpose)
  };
}

function mapSchedule(item) {
  const firstName = item[TYPES.schedule.fields.firstName] ?? '';
  const lastName = item[TYPES.schedule.fields.lastName] ?? '';
  const middleName = item[TYPES.schedule.fields.middleName] ?? '';

  return {
    id: String(item.id),
    title: item.title,
    dealId: item.parentId2 ? String(item.parentId2) : null,
    buyerName: [firstName, lastName, middleName].filter(Boolean).join(' '),
    amount: Number(item.opportunity ?? 0),
    currency: item.currencyId || 'AMD',
    paymentDate: item[TYPES.schedule.fields.paymentDate],
    status: item.stageId,
    remaining: Number(item[TYPES.schedule.fields.remaining] ?? item.opportunity ?? 0),
    partialPaid: Number(item[TYPES.schedule.fields.partialPaid] ?? 0),
    remainingRaw: item[TYPES.schedule.fields.remaining] ?? '',
    partialPaidRaw: item[TYPES.schedule.fields.partialPaid] ?? ''
  };
}

function getSuggestions(receipt, schedules, context) {
  const payableSchedules = schedules.filter((schedule) => schedule.dealId && isPayableSchedule(schedule, context.stages));
  const purposeNeedle = normalize(receipt.purpose);
  const exactAmount = payableSchedules.filter((schedule) => amountMatches(schedule, receipt.amount));
  const byPurpose = payableSchedules.filter((schedule) => purposeMatchesSchedule(receipt, schedule, purposeNeedle));
  const byPayer = payableSchedules.filter((schedule) => {
    if (!receipt.payerName || normalize(receipt.payerName).length < 3 || !schedule.buyerName) {
      return false;
    }

    return namesOverlap(receipt.payerName, schedule.buyerName);
  });

  const scheduleSuggestions = uniqueSchedules([...byPurpose, ...exactAmount, ...byPayer])
    .slice(0, 10)
    .map((schedule) => ({
      deal: {
        id: schedule.dealId,
        buyerName: schedule.deal?.buyerName || schedule.buyerName || `Deal #${schedule.dealId}`,
        address: schedule.deal?.title || schedule.title,
        schedules: [schedule]
      },
      scheduleIds: [schedule.id],
      score: getSuggestionScore(receipt, schedule),
      label: getSuggestionLabel(receipt, schedule),
      reason: `${schedule.title} / ${formatDate(schedule.paymentDate)}`
    }))
    .sort((a, b) => b.score - a.score);
  const documentPrefix = getDocumentPrefix(receipt.payerDocument);
  const contactDeals = context.contactDealsByDocument.get(documentPrefix) ?? [];
  const contactDealIds = new Set(contactDeals.map((deal) => deal.id));
  const scheduleIdsByContactDeal = new Map();

  for (const suggestion of scheduleSuggestions) {
    if (!contactDealIds.has(suggestion.deal.id)) continue;
    scheduleIdsByContactDeal.set(suggestion.deal.id, [
      ...(scheduleIdsByContactDeal.get(suggestion.deal.id) ?? []),
      ...suggestion.scheduleIds
    ]);
  }

  const contactSuggestions = contactDeals.map((deal) => ({
    deal: {
      id: deal.id,
      buyerName: deal.buyerName,
      address: deal.address,
      schedules: schedules
        .filter((schedule) => schedule.dealId === deal.id && isPayableSchedule(schedule, context.stages))
        .slice(0, 3)
    },
    scheduleIds: [...new Set(scheduleIdsByContactDeal.get(deal.id) ?? [])],
    score: CONTACT_MATCH_SCORE + getDirectDealScore(receipt, deal) - 70,
    label: 'Contact Match',
    reason: 'Payer document matched a Bitrix contact'
  }));
  const otherScheduleSuggestions = scheduleSuggestions.filter((suggestion) => !contactDealIds.has(suggestion.deal.id));
  const usedDealIds = new Set([
    ...otherScheduleSuggestions.map((suggestion) => suggestion.deal.id),
    ...contactDealIds
  ]);
  const directDealSuggestions = context.deals
    .filter((deal) => dealMatchesReceipt(receipt, deal))
    .filter((deal) => !usedDealIds.has(deal.id))
    .map((deal) => ({
      deal: {
        id: deal.id,
        buyerName: deal.buyerName,
        address: deal.address,
        schedules: []
      },
      scheduleIds: [],
      score: getDirectDealScore(receipt, deal),
      label: 'Deal Match',
      reason: deal.title
    }));

  return [...contactSuggestions, ...otherScheduleSuggestions, ...directDealSuggestions]
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

async function loadContactDealsByDocument(receipts, deals) {
  const documentPrefixes = [...new Set(receipts.map((receipt) => getDocumentPrefix(receipt.payerDocument)).filter(Boolean))];
  const result = new Map();

  if (!documentPrefixes.length) return result;

  const contactIdsByPrefix = await findContactIdsByDocumentPrefix(documentPrefixes);

  if (!contactIdsByPrefix.size) return result;

  const dealsByContactId = new Map();

  for (const deal of deals) {
    if (!deal.contactId) continue;
    dealsByContactId.set(deal.contactId, [...(dealsByContactId.get(deal.contactId) ?? []), deal]);
  }

  for (const [documentPrefix, contactIds] of contactIdsByPrefix) {
    const matchedDeals = uniqueById(contactIds.flatMap((contactId) => dealsByContactId.get(contactId) ?? []));

    if (matchedDeals.length) {
      result.set(documentPrefix, matchedDeals);
    }
  }

  return result;
}

async function findContactIdsByDocumentPrefix(documentPrefixes) {
  const contactIdsByPrefix = new Map();
  const exactMatches = await listBitrixMethod('crm.contact.list', {
    filter: { [`@${CONTACT_FIELDS.documentNumber}`]: documentPrefixes },
    select: ['ID', CONTACT_FIELDS.documentNumber]
  });
  collectContactIdsByPrefix(contactIdsByPrefix, exactMatches, documentPrefixes);

  // Contacts often store the document with a suffix (series, issue date), so the exact filter above
  // misses them: look the remaining prefixes up one by one with a substring filter.
  const unresolvedPrefixes = documentPrefixes
    .filter((documentPrefix) => !contactIdsByPrefix.has(documentPrefix))
    .slice(0, MAX_CONTACT_LOOKUPS);

  for (const documentPrefix of unresolvedPrefixes) {
    const partialMatches = await listBitrixMethod('crm.contact.list', {
      filter: { [`%${CONTACT_FIELDS.documentNumber}`]: documentPrefix },
      select: ['ID', CONTACT_FIELDS.documentNumber]
    });
    collectContactIdsByPrefix(contactIdsByPrefix, partialMatches, [documentPrefix]);
  }

  return contactIdsByPrefix;
}

function collectContactIdsByPrefix(target, contacts, documentPrefixes) {
  for (const contact of contacts) {
    const contactPrefix = getDocumentPrefix(contact[CONTACT_FIELDS.documentNumber]);

    if (!contactPrefix) continue;

    // Either side can be the shorter one when a document number is under nine characters.
    const documentPrefix = documentPrefixes.find(
      (prefix) => contactPrefix.startsWith(prefix) || prefix.startsWith(contactPrefix)
    );

    if (!documentPrefix) continue;

    const contactIds = target.get(documentPrefix) ?? [];
    const contactId = String(contact.ID);

    if (!contactIds.includes(contactId)) {
      target.set(documentPrefix, [...contactIds, contactId]);
    }
  }
}

function getDocumentPrefix(value) {
  const normalized = String(flattenValue(value)).toUpperCase().replace(/\s+/gu, '');
  const prefix = normalized.slice(0, DOCUMENT_PREFIX_LENGTH);

  return prefix.length >= MIN_DOCUMENT_PREFIX_LENGTH ? prefix : '';
}

function uniqueById(items) {
  const seen = new Set();

  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

async function listRecentDeals() {
  const response = await listBitrixMethod('crm.deal.list', {
    filter: { CATEGORY_ID: 5 },
    select: DEAL_SELECT,
    order: { ID: 'DESC' }
  });

  return response.map(mapDeal);
}

function mapDeal(deal) {
  const title = deal.TITLE ?? '';
  const buyerName = deal[DEAL_FIELDS.buyerName] || title;
  const searchableText = normalize(
    Object.entries(deal)
      .filter(([key]) => key === 'TITLE' || key.startsWith('UF_'))
      .map(([, value]) => flattenValue(value))
      .join(' ')
  );

  return {
    id: String(deal.ID),
    title,
    buyerName,
    address: title,
    amount: Number(deal.OPPORTUNITY ?? 0),
    currency: deal.CURRENCY_ID || 'AMD',
    contactId: String(deal[DEAL_FIELDS.contactId] ?? ''),
    projectId: String(deal[DEAL_FIELDS.project] ?? ''),
    buildingSectionId: String(deal[DEAL_FIELDS.buildingSection] ?? ''),
    searchableText
  };
}

function mapBankTransactionToVoucherFields(transaction, stages) {
  const amount = Number(transaction.amount ?? transaction.sum ?? 0);
  const currency = normalizeCurrency(transaction.currency);

  return {
    title: transaction.title ?? `Bank receipt ${transaction.transactionId ?? ''}`.trim(),
    xmlId: transaction.transactionId ? String(transaction.transactionId) : undefined,
    categoryId: TYPES.voucher.categoryId,
    stageId: stages.voucher.new,
    opportunity: amount,
    currencyId: currency,
    [TYPES.voucher.fields.payerName]: transaction.payerName ?? '',
    [TYPES.voucher.fields.beneficiaryName]: transaction.beneficiaryName ?? '',
    [TYPES.voucher.fields.amount]: amount,
    [TYPES.voucher.fields.paymentDate]: transaction.paymentDate ?? new Date().toISOString(),
    [TYPES.voucher.fields.currencyEnum]: transaction.currencyEnum ?? CURRENCY_ENUM[currency] ?? undefined,
    [TYPES.voucher.fields.purpose]: transaction.purpose ?? '',
    [TYPES.voucher.fields.debit]: transaction.debit ?? '',
    [TYPES.voucher.fields.credit]: transaction.credit ?? '',
    [TYPES.voucher.fields.payerDocument]: transaction.payerDocument ?? '',
    [TYPES.voucher.fields.payerAddress]: transaction.payerAddress ?? '',
    [TYPES.voucher.fields.amountWords]: transaction.amountWords ?? ''
  };
}

async function getBitrixDeal(dealId) {
  return callBitrixMethod('crm.deal.get', { id: dealId });
}

async function getBitrixVoucher(receiptId) {
  const response = await callBitrixMethod('crm.item.get', {
    entityTypeId: TYPES.voucher.entityTypeId,
    id: receiptId
  });
  return response.item ?? response;
}

function assertMatchEntities({ deal, receipt, dealId, stages }) {
  if (Number(deal?.[DEAL_FIELDS.categoryId]) !== 5) {
    throw requestError('Selected deal is outside the allowed Bitrix category');
  }
  if (Number(receipt?.categoryId) !== TYPES.voucher.categoryId) {
    throw requestError('Selected receipt is outside the bank receipt Smart Process');
  }
  if (String(receipt.parentId2 ?? '') === String(dealId) && receipt.stageId !== stages.voucher.new) {
    throw requestError('Receipt is already matched with this deal', 409);
  }
  if (receipt.stageId !== stages.voucher.new) {
    throw requestError('Only unmatched bank receipts can be confirmed', 409);
  }
}

async function validateSelectedSchedules(scheduleIds, dealId, stages) {
  const uniqueIds = [...new Set(scheduleIds.map(String))];
  if (!uniqueIds.length) return;

  const schedules = await listBitrixMethod('crm.item.list', {
    entityTypeId: TYPES.schedule.entityTypeId,
    filter: { '@id': uniqueIds },
    select: ['id', 'categoryId', 'parentId2', 'stageId']
  });
  const byId = new Map(schedules.map((schedule) => [String(schedule.id), schedule]));

  for (const scheduleId of uniqueIds) {
    const schedule = byId.get(scheduleId);
    if (!schedule) throw requestError(`Payment schedule #${scheduleId} was not found`);
    if (Number(schedule.categoryId) !== TYPES.schedule.categoryId || String(schedule.parentId2 ?? '') !== String(dealId)) {
      throw requestError(`Payment schedule #${scheduleId} does not belong to the selected deal/category`);
    }
    if (![stages.schedule.unpaid, stages.schedule.partial].includes(schedule.stageId)) {
      throw requestError(`Payment schedule #${scheduleId} is not payable`, 409);
    }
  }
}

function requestError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function getDealContactId(deal) {
  const contactId = deal?.CONTACT_ID ?? deal?.contactId;

  if (contactId) {
    return String(contactId);
  }

  const contactIds = deal?.CONTACT_IDS ?? deal?.contactIds;

  return Array.isArray(contactIds) && contactIds.length ? String(contactIds[0]) : null;
}

function appendUniqueId(value, id) {
  const current = Array.isArray(value) ? value : String(value ?? '').split(',');
  const normalizedId = String(id);
  const next = current.map((item) => String(item).trim()).filter(Boolean);

  if (!next.includes(normalizedId)) {
    next.push(normalizedId);
  }

  return next;
}

async function recalculateDealSchedules(dealId, stages, linkedReceiptIds = []) {
  const [vouchers, scheduleResponse] = await Promise.all([
    listDealVouchers(dealId, linkedReceiptIds),
    listBitrixMethod('crm.item.list', {
      entityTypeId: TYPES.schedule.entityTypeId,
      order: { id: 'ASC' },
      filter: {
        categoryId: TYPES.schedule.categoryId,
        parentId2: dealId
      },
      select: [
        'id',
        'stageId',
        'opportunity',
        'currencyId',
        TYPES.schedule.fields.partialPaid,
        TYPES.schedule.fields.remaining
      ]
    })
  ]);
  const amdTotal = sumAmdVouchers(vouchers);
  const schedules = scheduleResponse.map(mapSchedule).sort((left, right) => Number(left.id) - Number(right.id));
  const updates = planScheduleUpdates(schedules, amdTotal, stages);
  const completed = [];
  try {
    for (const update of updates) {
      await updateSchedule(update.schedule.id, update.fields);
      completed.push(update.schedule);
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const schedule of completed.reverse()) {
      await updateSchedule(schedule.id, {
        stageId: schedule.status,
        [TYPES.schedule.fields.partialPaid]: schedule.partialPaidRaw,
        [TYPES.schedule.fields.remaining]: schedule.remainingRaw
      }).catch((rollbackError) => rollbackErrors.push(rollbackError));
    }
    if (rollbackErrors.length) {
      error.message = `${error.message}; schedule rollback failed: ${rollbackErrors.map((item) => item.message).join('; ')}`;
    }
    throw error;
  }

  return {
    amdTotal,
    updatedSchedules: updates.length
  };
}

export function sumAmdVouchers(vouchers) {
  return vouchers
    .filter((voucher) => isAmdVoucher(voucher))
    .reduce((sum, voucher) => sum + Number(voucher[TYPES.voucher.fields.amount] ?? voucher.opportunity ?? 0), 0);
}

export function planScheduleUpdates(schedules, amdTotal, stages) {
  let available = amdTotal;
  const updates = [];

  for (const schedule of schedules) {
    const amount = Number(schedule.amount ?? 0);
    const paid = Math.min(available, amount);
    available = Math.max(available - amount, 0);

    if (schedule.status === stages.schedule.paid) {
      continue;
    }

    if (paid >= amount && amount > 0) {
      updates.push({ schedule, fields: {
        stageId: stages.schedule.paid,
        [TYPES.schedule.fields.partialPaid]: '',
        [TYPES.schedule.fields.remaining]: ''
      }});
    } else if (paid > 0) {
      updates.push({ schedule, fields: {
        stageId: stages.schedule.partial,
        [TYPES.schedule.fields.partialPaid]: paid,
        [TYPES.schedule.fields.remaining]: amount - paid
      }});
    } else if (schedule.status === stages.schedule.partial) {
      updates.push({ schedule, fields: {
        stageId: stages.schedule.unpaid,
        [TYPES.schedule.fields.partialPaid]: '',
        [TYPES.schedule.fields.remaining]: ''
      }});
    }
  }

  return updates;
}

export function getDefaultStages() {
  return {
    voucher: { ...TYPES.voucher.stages },
    schedule: { ...TYPES.schedule.stages }
  };
}

async function listDealVouchers(dealId, linkedReceiptIds = []) {
  const select = [
    'id',
    'stageId',
    'opportunity',
    'currencyId',
    TYPES.voucher.fields.amount,
    TYPES.voucher.fields.currencyEnum
  ];
  const receiptIds = [...new Set(linkedReceiptIds.map(String).filter(Boolean))];
  const requests = [
    listBitrixMethod('crm.item.list', {
      entityTypeId: TYPES.voucher.entityTypeId,
      order: { id: 'ASC' },
      filter: {
        categoryId: TYPES.voucher.categoryId,
        parentId2: dealId
      },
      select
    })
  ];

  // The deal field is the contractual source of truth, so receipts linked there but missing the
  // parent relation still have to be part of the total.
  if (receiptIds.length) {
    requests.push(
      listBitrixMethod('crm.item.list', {
        entityTypeId: TYPES.voucher.entityTypeId,
        order: { id: 'ASC' },
        filter: {
          categoryId: TYPES.voucher.categoryId,
          '@id': receiptIds
        },
        select
      })
    );
  }

  const responses = await Promise.all(requests);

  return uniqueById(responses.flat().map((voucher) => ({ ...voucher, id: String(voucher.id) })));
}

function updateSchedule(id, fields) {
  return callBitrixMethod('crm.item.update', {
    entityTypeId: TYPES.schedule.entityTypeId,
    id,
    fields
  });
}

function isAmdVoucher(voucher) {
  const currencyEnum = Number(voucher[TYPES.voucher.fields.currencyEnum] ?? 0);

  // The currency enum field is what the manager edits when converting a foreign receipt to AMD,
  // so it wins over currencyId whenever it is filled in.
  if (currencyEnum) {
    return currencyEnum === CURRENCY_ENUM.AMD;
  }

  return String(voucher.currencyId ?? '').trim().toUpperCase() === 'AMD';
}

function normalizeCurrency(value) {
  return String(value ?? 'AMD').trim().toUpperCase() || 'AMD';
}

async function findVoucherByExternalId(transactionId) {
  if (!transactionId) {
    return null;
  }

  const response = await callBitrixMethod('crm.item.list', {
    entityTypeId: TYPES.voucher.entityTypeId,
    filter: {
      xmlId: String(transactionId)
    },
    select: ['id', 'title', 'xmlId']
  });

  return response.items?.[0] ?? null;
}

function matchFirst(value, patterns) {
  for (const pattern of patterns) {
    const match = value.match(pattern);

    if (match) {
      return match;
    }
  }

  return null;
}

function maskMatches(value, patterns) {
  let masked = value;

  for (const pattern of patterns) {
    masked = masked.replace(pattern, (match) => ' '.repeat(match.length));
  }

  return masked;
}

export function normalize(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('hy-AM')
    .replace(/[‐‑‒–—]/gu, '-')
    .replace(/№/gu, '#')
    .replace(/\s+/gu, ' ')
    .trim();
}

function uniqueSchedules(schedules) {
  const seen = new Set();

  return schedules.filter((schedule) => {
    if (seen.has(schedule.id)) {
      return false;
    }

    seen.add(schedule.id);
    return true;
  });
}

function isPayableSchedule(schedule, stages) {
  if (schedule.status === stages.schedule.paid) {
    return false;
  }

  return (
    schedule.status === stages.schedule.unpaid ||
    schedule.status === stages.schedule.partial ||
    schedule.remaining > 0
  );
}

function purposeMatchesSchedule(receipt, schedule, purposeNeedle = normalize(receipt.purpose)) {
  const haystack = getScheduleSearchableText(schedule);
  const dealTitle = normalize(schedule.deal?.title);

  if (purposeNeedle.length >= 3 && (includesText(haystack, purposeNeedle) || includesText(purposeNeedle, dealTitle))) {
    return true;
  }

  const parsed = receipt.parsed ?? {};
  const numberTokens = getNumberTokens(haystack);
  const buildingMatches = parsed.building ? numberTokens.has(normalizeNumber(parsed.building)) : false;
  const apartmentMatches = parsed.apartment ? numberTokens.has(normalizeNumber(parsed.apartment)) : false;
  const preliminaryMatches = parsed.preliminaryNumber ? numberTokens.has(normalizeNumber(parsed.preliminaryNumber)) : false;
  const areaMatches = parsed.area ? numberTokens.has(normalizeNumber(parsed.area)) : false;
  const projectMatches = parsed.project ? includesText(haystack, parsed.project) : false;
  const contractMatches = parsed.contractDate ? includesText(haystack, parsed.contractDate) : false;

  return (
    (buildingMatches && apartmentMatches) ||
    (buildingMatches && preliminaryMatches) ||
    (projectMatches && (apartmentMatches || preliminaryMatches || areaMatches || contractMatches))
  );
}

function amountMatches(schedule, receiptAmount) {
  const amount = Number(receiptAmount ?? 0);
  const scheduleAmount = Number(schedule.amount ?? 0);
  const remaining = Number(schedule.remaining ?? scheduleAmount);

  return scheduleAmount === amount || remaining === amount;
}

function dealMatchesReceipt(receipt, deal) {
  const parsed = receipt.parsed ?? {};
  const haystack = deal.searchableText;
  const numberTokens = getNumberTokens(haystack);
  const buildingMatches = parsed.building ? numberTokens.has(normalizeNumber(parsed.building)) : false;
  const apartmentMatches = parsed.apartment ? numberTokens.has(normalizeNumber(parsed.apartment)) : false;
  const preliminaryMatches = parsed.preliminaryNumber ? numberTokens.has(normalizeNumber(parsed.preliminaryNumber)) : false;
  const areaMatches = parsed.area ? numberTokens.has(normalizeNumber(parsed.area)) : false;
  const projectMatches = parsed.project ? includesText(haystack, parsed.project) : false;
  const contractMatches = parsed.contractDate ? includesText(haystack, parsed.contractDate) : false;
  const payerMatches = receipt.payerName ? namesOverlap(receipt.payerName, deal.buyerName) : false;

  return (
    (buildingMatches && apartmentMatches) ||
    (buildingMatches && preliminaryMatches) ||
    (projectMatches && (apartmentMatches || preliminaryMatches || areaMatches || contractMatches)) ||
    (payerMatches && (buildingMatches || apartmentMatches || projectMatches))
  );
}

function getDirectDealScore(receipt, deal) {
  const parsed = receipt.parsed ?? {};
  const haystack = deal.searchableText;
  const numberTokens = getNumberTokens(haystack);
  let score = 70;

  if (parsed.project && includesText(haystack, parsed.project)) {
    score += 10;
  }

  if (parsed.building && numberTokens.has(normalizeNumber(parsed.building))) {
    score += 8;
  }

  if (parsed.apartment && numberTokens.has(normalizeNumber(parsed.apartment))) {
    score += 8;
  }

  if (parsed.area && numberTokens.has(normalizeNumber(parsed.area))) {
    score += 4;
  }

  if (receipt.payerName && namesOverlap(receipt.payerName, deal.buyerName)) {
    score += 6;
  }

  return score;
}

function namesOverlap(left, right) {
  const leftWords = normalize(left)
    .split(' ')
    .filter((word) => word.length >= 3);
  const rightText = normalize(right);

  return leftWords.some((word) => rightText.includes(word));
}

function getScheduleSearchableText(schedule) {
  return normalize(
    [
      schedule.title,
      schedule.buyerName,
      schedule.deal?.title,
      schedule.deal?.buyerName,
      schedule.deal?.address,
      schedule.deal?.searchableText
    ].join(' ')
  );
}

function getNumberTokens(value) {
  return new Set(normalize(value).match(/\d+(?:[.,/]\d+)?/gu)?.map(normalizeNumber) ?? []);
}

function normalizeNumber(value) {
  return normalize(value).replace(',', '.');
}

function includesText(haystack, needle) {
  const normalizedNeedle = normalize(needle);

  return Boolean(normalizedNeedle) && normalize(haystack).includes(normalizedNeedle);
}

function flattenValue(value) {
  if (Array.isArray(value)) {
    return value.map(flattenValue).join(' ');
  }

  if (value && typeof value === 'object') {
    return Object.values(value).map(flattenValue).join(' ');
  }

  return value ?? '';
}

function transliterateLatinToArmenian(value) {
  const normalizedValue = normalize(value);
  const dictionary = {
    anahit: '\u0531\u0576\u0561\u0570\u056b\u057f',
    aram: '\u0531\u0580\u0561\u0574',
    armen: '\u0531\u0580\u0574\u0565\u0576',
    anna: '\u0531\u0576\u0576\u0561',
    karen: '\u053f\u0561\u0580\u0565\u0576',
    lilit: '\u053c\u056b\u056c\u056b\u0569',
    narine: '\u0546\u0561\u0580\u056b\u0576\u0565'
  };

  return dictionary[normalizedValue] ?? value;
}

function getSuggestionScore(receipt, schedule) {
  const purposeNeedle = normalize(receipt.purpose);
  const dealTitle = normalize(schedule.deal?.title);
  const haystack = getScheduleSearchableText(schedule);

  if (purposeNeedle && dealTitle && (purposeNeedle.includes(dealTitle) || dealTitle.includes(purposeNeedle))) {
    return amountMatches(schedule, receipt.amount) ? 100 : 90;
  }

  if (purposeMatchesSchedule(receipt, schedule, purposeNeedle)) {
    return amountMatches(schedule, receipt.amount) ? 98 : 88;
  }

  if (namesOverlap(receipt.payerName, schedule.buyerName) && amountMatches(schedule, receipt.amount)) {
    return 92;
  }

  if (amountMatches(schedule, receipt.amount)) {
    return 85;
  }

  return haystack ? 70 : 50;
}

function getSuggestionLabel(receipt, schedule) {
  const purposeNeedle = normalize(receipt.purpose);
  const dealTitle = normalize(schedule.deal?.title);

  if (purposeNeedle && dealTitle && (purposeNeedle.includes(dealTitle) || dealTitle.includes(purposeNeedle))) {
    return 'Purpose Match';
  }

  if (purposeMatchesSchedule(receipt, schedule, purposeNeedle)) {
    return 'Details Match';
  }

  if (amountMatches(schedule, receipt.amount)) {
    return 'Amount Match';
  }

  return 'Name Match';
}

function formatDate(value) {
  if (!value) {
    return '';
  }

  return new Date(value).toLocaleDateString('hy-AM');
}
