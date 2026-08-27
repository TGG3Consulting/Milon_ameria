import React, { useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  Check,
  CheckCircle2,
  Clock3,
  Filter,
  RefreshCw,
  Search,
  X
} from 'lucide-react';
import {
  confirmMatch,
  getReceipts,
  searchDeals
} from './lib/api.js';
import './styles.css';

const BUILDING_OPTIONS = [
  { label: 'Milon Tower', value: '1507' },
  { label: 'Milon Plaza', value: '1505' },
  { label: 'Milon Hills', value: '1503' }
];

export default function App() {
  const [board, setBoard] = useState({ unmatched: [], matched: [], log: [] });
  const [selectedReceiptId, setSelectedReceiptId] = useState('');
  const [manualFilters, setManualFilters] = useState({ name: '', building: '', apartment: '' });
  const [manualDeals, setManualDeals] = useState([]);
  const [manualSearchLoading, setManualSearchLoading] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState(null);
  const [manualSearchOpen, setManualSearchOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [receiptQueueIndex, setReceiptQueueIndex] = useState(0);
  const [selectedSuggestionId, setSelectedSuggestionId] = useState('');
  const [suggestionModalClosed, setSuggestionModalClosed] = useState(false);
  const [suggestionAccepting, setSuggestionAccepting] = useState(false);
  const [viewedDeal, setViewedDeal] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmingReceiptIds, setConfirmingReceiptIds] = useState([]);
  const [pendingMatches, setPendingMatches] = useState([]);
  const [processingMatches, setProcessingMatches] = useState([]);
  const [openFilterKey, setOpenFilterKey] = useState('');
  const [columnFilters, setColumnFilters] = useState({
    unmatched: createEmptyColumnFilter(),
    matched: createEmptyColumnFilter()
  });
  const [error, setError] = useState('');

  const visibleUnmatched = useMemo(
    () => filterReceipts(board.unmatched, columnFilters.unmatched),
    [board.unmatched, columnFilters.unmatched]
  );
  const visibleMatched = useMemo(
    () => filterReceipts(board.matched, columnFilters.matched),
    [board.matched, columnFilters.matched]
  );
  const selectedReceipt =
    visibleUnmatched.find((receipt) => receipt.id === selectedReceiptId) ?? visibleUnmatched[0] ?? board.unmatched[0] ?? null;
  const receiptQueue = board.unmatched.filter((receipt) => receipt.suggestions?.length);
  const activeReceipt = suggestionModalClosed ? null : receiptQueue[receiptQueueIndex] ?? null;
  const selectedModalSuggestion =
    activeReceipt?.suggestions.find((suggestion) => getSuggestionId(suggestion) === selectedSuggestionId) ??
    activeReceipt?.suggestions[0] ??
    null;

  function isMatchQueued(receiptId) {
    const normalizedId = String(receiptId ?? '');
    return Boolean(
      normalizedId &&
        (pendingMatches.some((match) => match.receiptId === normalizedId) ||
          processingMatches.some((match) => match.receiptId === normalizedId))
    );
  }

  async function refreshData() {
    setLoading(true);
    setError('');

    try {
      const receiptData = await getReceipts();
      setBoard(receiptData);
      setSelectedReceiptId((current) => current || receiptData.unmatched[0]?.id || '');
      setReceiptQueueIndex(0);
      setSelectedSuggestionId('');
      setInitialLoaded(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleSearch(nextFilters = manualFilters) {
    setManualFilters(nextFilters);
    setSelectedDeal(null);
  }

  async function executeConfirm({ receiptId, dealId, scheduleIds, jobKey, controller }) {
    setError('');

    if (!receiptId || confirmingReceiptIds.includes(String(receiptId))) {
      return false;
    }

    setConfirmingReceiptIds((current) => [...current, String(receiptId)]);

    try {
      await confirmMatch({
        receiptId,
        dealId,
        scheduleIds
      }, {
        signal: controller?.signal
      });
      setSelectedDeal(null);
      setManualDeals([]);
      await refreshData();
      return true;
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message);
      }
      return false;
    } finally {
      setConfirmingReceiptIds((current) => current.filter((id) => id !== String(receiptId)));
      if (jobKey) {
        setProcessingMatches((current) => current.filter((match) => match.jobKey !== jobKey));
      }
    }
  }

  function handleConfirm({ receiptId = selectedReceipt?.id, dealId, scheduleIds }) {
    const nextReceiptId = receiptId ? String(receiptId) : '';

    setError('');

    const isAlreadyQueued =
      pendingMatches.some((match) => match.receiptId === nextReceiptId) ||
      processingMatches.some((match) => match.receiptId === nextReceiptId);

    if (!nextReceiptId || confirmingReceiptIds.includes(nextReceiptId) || isAlreadyQueued) {
      return false;
    }

    setPendingMatches((current) => [...current, {
      jobKey: `${nextReceiptId}-${Date.now()}`,
      receiptId: nextReceiptId,
      dealId,
      scheduleIds: scheduleIds ?? [],
      seconds: 30
    }]);

    return true;
  }

  function cancelPendingMatch(jobKey) {
    setPendingMatches((current) => current.filter((match) => match.jobKey !== jobKey));
  }

  function cancelProcessingMatch(jobKey) {
    setProcessingMatches((current) => {
      const match = current.find((item) => item.jobKey === jobKey);
      match?.controller?.abort();
      return current.filter((item) => item.jobKey !== jobKey);
    });
  }

  function cancelAllMatches() {
    setPendingMatches([]);
    setProcessingMatches((current) => {
      current.forEach((match) => match.controller?.abort());
      return [];
    });
  }

  async function handleAcceptSuggestion() {
    if (!activeReceipt || !selectedModalSuggestion) {
      return;
    }

    setSuggestionAccepting(true);

    try {
      const confirmed = await handleConfirm({
        receiptId: activeReceipt.id,
        dealId: selectedModalSuggestion.deal.id,
        scheduleIds: selectedModalSuggestion.scheduleIds
      });
      if (confirmed) {
        setReceiptQueueIndex(0);
        setSelectedSuggestionId('');
        setSuggestionModalClosed(true);
      }
    } finally {
      setSuggestionAccepting(false);
    }
  }

  function handleSkipReceiptSuggestions() {
    const nextIndex = receiptQueueIndex + 1;

    if (nextIndex >= receiptQueue.length) {
      setSuggestionModalClosed(true);
      return;
    }

    setReceiptQueueIndex(nextIndex);
    setSelectedSuggestionId('');
  }

  useEffect(() => {
    refreshData();
  }, []);

  useEffect(() => {
    if (!pendingMatches.length) return undefined;

    const interval = window.setInterval(() => {
      setPendingMatches((current) => {
        const ready = [];
        const waiting = [];

        for (const match of current) {
          const nextMatch = { ...match, seconds: Math.max(match.seconds - 1, 0) };
          if (nextMatch.seconds <= 0) {
            ready.push(nextMatch);
          } else {
            waiting.push(nextMatch);
          }
        }

        for (const match of ready) {
          const controller = new AbortController();
          const processingMatch = { ...match, controller };
          setProcessingMatches((processing) => [...processing, processingMatch]);
          executeConfirm(processingMatch);
        }

        return waiting;
      });
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [pendingMatches.length]);

  useEffect(() => {
    if (!manualSearchOpen) return undefined;

    const hasSearchValue = Object.values(manualFilters).some((value) => String(value).trim());
    if (!hasSearchValue) {
      setManualDeals([]);
      setManualSearchLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setManualSearchLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const data = await searchDeals(manualFilters, { signal: controller.signal });
        setManualDeals(data.deals);
      } catch (err) {
        if (err.name !== 'AbortError') setError(err.message);
      } finally {
        if (!controller.signal.aborted) setManualSearchLoading(false);
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [manualFilters, manualSearchOpen]);

  useEffect(() => {
    if (receiptQueueIndex >= receiptQueue.length) {
      setReceiptQueueIndex(0);
    }
  }, [receiptQueue.length, receiptQueueIndex]);

  if (!initialLoaded) {
    return <LoadingScreen error={error} loading={loading} onRetry={refreshData} />;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Milon Mining</p>
          <h1>Բանկային կտրոնների համադրում</h1>
        </div>
        <div className="top-actions">
          <button className="history-button" type="button" onClick={() => setHistoryOpen(true)} aria-label="History" title="History">
            <Clock3 size={20} />
            History
          </button>
        </div>
      </header>

      {error ? <div className="alert">{error}</div> : null}

      <section className="workspace">
        <div className="kanban">
          <Column
            title="Չհամապատասխանեցված"
            count={visibleUnmatched.length}
            totalCount={board.unmatched.length}
            receipts={visibleUnmatched}
            selectedReceiptId={selectedReceipt?.id}
            onSelect={setSelectedReceiptId}
            filterKey="unmatched"
            filter={columnFilters.unmatched}
            isFilterOpen={openFilterKey === 'unmatched'}
            onFilterToggle={setOpenFilterKey}
            onFilterChange={(filter) => setColumnFilters((current) => ({ ...current, unmatched: filter }))}
            interactive
          />
          <Column
            title="Համապատասխանեցված"
            count={visibleMatched.length}
            totalCount={board.matched.length}
            receipts={visibleMatched}
            filterKey="matched"
            filter={columnFilters.matched}
            isFilterOpen={openFilterKey === 'matched'}
            onFilterToggle={setOpenFilterKey}
            onFilterChange={(filter) => setColumnFilters((current) => ({ ...current, matched: filter }))}
          />
        </div>

        <aside className="sidebar">
          <ReceiptSidebar
            receipt={selectedReceipt}
            loading={loading}
            confirming={Boolean(
              selectedReceipt?.id &&
                (confirmingReceiptIds.includes(String(selectedReceipt.id)) ||
                  isMatchQueued(selectedReceipt.id))
            )}
            onDealView={setViewedDeal}
            onConfirm={handleConfirm}
            onOpenManualSearch={() => setManualSearchOpen(true)}
          />
        </aside>
      </section>

      {board.log.length < 0 ? <section className="activity">
        <div className="section-title">
          <Clock3 size={18} />
          <h2>Գործողությունների պատմություն</h2>
        </div>
        <div className="activity-list">
          {board.log.map((item) => (
            <div className="activity-row" key={item.id}>
              <span>{formatArmenianDateTime(item.createdAt)}</span>
              <strong>{item.receiptId}</strong>
              <p>{formatActivityAction(item.action)}</p>
            </div>
          ))}
        </div>
      </section> : null}

      {activeReceipt ? (
        <SuggestionModal
          receipt={activeReceipt}
          accepting={
            suggestionAccepting ||
            Boolean(activeReceipt?.id && isMatchQueued(activeReceipt.id))
          }
          index={receiptQueueIndex}
          selectedSuggestionId={selectedSuggestionId || getSuggestionId(activeReceipt.suggestions[0])}
          total={receiptQueue.length}
          onAccept={handleAcceptSuggestion}
          onDealView={setViewedDeal}
          onSelectSuggestion={setSelectedSuggestionId}
          onSkip={handleSkipReceiptSuggestions}
        />
      ) : null}
      {manualSearchOpen ? (
        <ManualSearchModal
          deals={manualDeals}
          filters={manualFilters}
          loading={manualSearchLoading}
          confirming={Boolean(
            selectedReceipt?.id &&
              (confirmingReceiptIds.includes(String(selectedReceipt.id)) ||
                isMatchQueued(selectedReceipt.id))
          )}
          selectedDeal={selectedDeal}
          onClose={() => setManualSearchOpen(false)}
          onConfirm={(payload) => {
            setManualSearchOpen(false);
            handleConfirm(payload);
          }}
          onSearch={handleSearch}
          onSelectDeal={setSelectedDeal}
        />
      ) : null}
      {viewedDeal ? <DealDetailsModal deal={viewedDeal} onClose={() => setViewedDeal(null)} /> : null}
      {historyOpen ? <HistoryModal log={board.log} onClose={() => setHistoryOpen(false)} /> : null}
      {pendingMatches.length || processingMatches.length ? (
        <div className="pending-match-stack">
          {pendingMatches.length + processingMatches.length > 1 ? (
            <button className="secondary cancel-all-matches-button" type="button" onClick={cancelAllMatches}>
              <X size={16} />
              Cancel all
            </button>
          ) : null}
          {pendingMatches.map((match) => (
            <PendingMatchModal
              key={match.jobKey}
              match={match}
              seconds={match.seconds}
              onCancel={() => cancelPendingMatch(match.jobKey)}
            />
          ))}
          {processingMatches.map((match) => (
            <PendingMatchModal
              key={match.jobKey}
              match={match}
              seconds={null}
              onCancel={() => cancelProcessingMatch(match.jobKey)}
            />
          ))}
        </div>
      ) : null}
    </main>
  );
}

function LoadingScreen({ error, loading, onRetry }) {
  return (
    <main className="loading-screen">
      <div className="loading-panel">
        <div className="loading-mark">
          <RefreshCw size={26} />
        </div>
        <p className="eyebrow">Milon Mining</p>
        <h1>Տվյալները բեռնվում են</h1>
        <span>Սպասեք մի քանի վայրկյան, էջը կբացվի արդեն պատրաստ տվյալներով։</span>
        {error ? <div className="loading-error">{error}</div> : null}
        {error && !loading ? (
          <button type="button" onClick={onRetry}>
            <RefreshCw size={16} />
            Կրկնել
          </button>
        ) : null}
      </div>
    </main>
  );
}

function SuggestionModal({
  receipt,
  accepting,
  index,
  selectedSuggestionId,
  total,
  onAccept,
  onDealView,
  onSelectSuggestion,
  onSkip
}) {
  return (
    <div className="suggestion-modal-backdrop" role="presentation">
      <section className="suggestion-modal" role="dialog" aria-modal="true" aria-labelledby="suggestion-modal-title">
        <div className="suggestion-modal-head">
          <div>
            <p className="eyebrow">Smart Match</p>
            <h2 id="suggestion-modal-title">{'\u053d\u0565\u056c\u0561\u0581\u056b \u0561\u057c\u0561\u057b\u0561\u0580\u056f\u0576\u0565\u0580'}</h2>
          </div>
          <span>
            {index + 1} / {total}
          </span>
        </div>

        <div className="modal-receipt">
          <div className="section-title">
            <Banknote size={18} />
            <h3>{'\u053f\u057f\u0580\u0578\u0576'}</h3>
          </div>
          <strong>{formatMoney(receipt.amount, receipt.currency)}</strong>
          <span>{receipt.payerName}</span>
          <p>{receipt.purpose}</p>
          <ParsedBadges parsed={receipt.parsed} />
        </div>

        <div className="modal-suggestion-list">
          <div className="section-title">
            <CheckCircle2 size={18} />
            <h3>{'\u0532\u0578\u056c\u0578\u0580 \u0561\u057c\u0561\u057b\u0561\u0580\u056f\u0576\u0565\u0580\u0568'}</h3>
          </div>
          {receipt.suggestions.map((suggestion) => {
            const suggestionId = getSuggestionId(suggestion);

            return (
              <label className="modal-suggestion-option" key={suggestionId}>
                <input
                  checked={selectedSuggestionId === suggestionId}
                  onChange={() => onSelectSuggestion(suggestionId)}
                  type="checkbox"
                />
                <span>
                  <div className="suggestion-head">
                    <button
                      className="deal-name-button"
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        onDealView(suggestion.deal);
                      }}
                    >
                      {suggestion.deal.buyerName}
                    </button>
                    <em>{suggestion.label}</em>
                  </div>
                  <p>{suggestion.deal.address}</p>
                  <div className="suggestion-meta">
                    <span>Deal #{suggestion.deal.id}</span>
                    <span>Score {suggestion.score}</span>
                    {suggestion.scheduleIds?.length ? <span>Schedule {suggestion.scheduleIds.join(', ')}</span> : null}
                  </div>
                  <small>{suggestion.reason}</small>
                </span>
              </label>
            );
          })}
        </div>

        <div className="suggestion-modal-actions">
          <button className="secondary" type="button" onClick={onSkip} disabled={accepting}>
            Skip
          </button>
          <button type="button" onClick={onAccept} disabled={accepting || !receipt.suggestions.length}>
            <Check size={16} />
            {accepting ? '\u053f\u0561\u057a\u057e\u0578\u0582\u0574 \u0567' : '\u0538\u0576\u0564\u0578\u0582\u0576\u0565\u056c'}
          </button>
        </div>
      </section>
    </div>
  );
}
function HistoryModal({ log, onClose }) {
  const [historyType, setHistoryType] = useState('matched');
  const [dateFilter, setDateFilter] = useState({ from: '', to: '' });
  const matchedLog = log.filter((item) => isMatchedActivity(item.action));
  const createdLog = log.filter((item) => isCreatedReceiptActivity(item.action));
  const visibleLog = filterHistoryByDate(historyType === 'matched' ? matchedLog : createdLog, dateFilter);

  return (
    <div className="suggestion-modal-backdrop" role="presentation">
      <section className="history-modal" role="dialog" aria-modal="true" aria-labelledby="history-title">
        <div className="suggestion-modal-head">
          <div>
            <p className="eyebrow">History</p>
            <h2 id="history-title">Գործողությունների պատմություն</h2>
          </div>
          <button className="secondary icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="history-filters" aria-label="History filters">
          <button
            className={historyType === 'matched' ? 'active' : ''}
            type="button"
            onClick={() => setHistoryType('matched')}
          >
            Համապատասխանեցված
            <span>{matchedLog.length}</span>
          </button>
          <button
            className={historyType === 'created' ? 'active' : ''}
            type="button"
            onClick={() => setHistoryType('created')}
          >
            Ստեղծված կտրոններ
            <span>{createdLog.length}</span>
          </button>
        </div>
        <div className="history-date-filters">
          <label>
            <span>Սկիզբ</span>
            <input
              type="date"
              value={dateFilter.from}
              onChange={(event) => setDateFilter((current) => ({ ...current, from: event.target.value }))}
            />
          </label>
          <label>
            <span>Մինչև</span>
            <input
              type="date"
              value={dateFilter.to}
              onChange={(event) => setDateFilter((current) => ({ ...current, to: event.target.value }))}
            />
          </label>
        </div>
        <div className="activity-list history-list">
          {visibleLog.map((item) => (
            <div className="activity-row" key={item.id}>
              <span>{formatArmenianDateTime(item.createdAt)}</span>
              <strong>{item.receiptId}</strong>
              <p>{formatActivityAction(item.action)}</p>
            </div>
          ))}
          {!visibleLog.length ? <p className="muted">Պատմություն չկա</p> : null}
        </div>
      </section>
    </div>
  );
}

function PendingMatchModal({ match, seconds, onCancel }) {
  const isProcessing = seconds === null;

  return (
    <div className="suggestion-modal-backdrop pending-match-backdrop" role="presentation">
      <section className={`pending-match-modal ${isProcessing ? 'is-processing' : ''}`} role="dialog" aria-modal="true" aria-labelledby="pending-match-title">
        <div className="suggestion-modal-head">
          <div>
            <p className="eyebrow">Pending Match</p>
            <h2 id="pending-match-title">{'\u0540\u0561\u0574\u0561\u057a\u0561\u057f\u0561\u057d\u056d\u0561\u0576\u0565\u0581\u0578\u0582\u0574\u0568 \u056f\u057d\u056f\u057d\u057e\u056b \u0577\u0578\u0582\u057f\u0578\u057e'}</h2>
          </div>
          <span>{isProcessing ? <RefreshCw size={18} /> : seconds}</span>
        </div>
        <div className="pending-countdown">
          <strong className="processing-label">Հաշվարկվում է</strong>
          <strong>{seconds} վրկ</strong>
          <p>
            {'\u053f\u057f\u0580\u0578\u0576 #'}
            {match.receiptId}
            {' \u056f\u0570\u0561\u0574\u0561\u057a\u0561\u057f\u0561\u057d\u056d\u0561\u0576\u0565\u0581\u057e\u056b Deal #'}
            {match.dealId}
            {' \u0563\u0578\u0580\u056e\u0561\u0580\u0584\u056b\u0576, \u0565\u0569\u0565 \u0579\u0579\u0565\u0572\u0561\u0580\u056f\u0565\u0584:'}
          </p>
        </div>
        <div className="suggestion-modal-actions">
          <button className="secondary cancel-pending-button" type="button" onClick={onCancel}>
            <X size={16} />
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

function Column({
  title,
  count,
  totalCount,
  receipts,
  selectedReceiptId,
  onSelect,
  filterKey,
  filter,
  isFilterOpen,
  onFilterToggle,
  onFilterChange,
  interactive = false
}) {
  const isFiltered = hasActiveColumnFilter(filter);

  return (
    <section className="column">
      <div className="column-header">
        <h2>{title}</h2>
        <div className="column-tools">
          <button
            className={`filter-button ${isFiltered ? 'active' : ''}`}
            type="button"
            onClick={() => onFilterToggle(isFilterOpen ? '' : filterKey)}
            aria-label="Ֆիլտր"
            title="Ֆիլտր"
          >
            <Filter size={14} />
          </button>
          <span>{count}</span>
        </div>
        {isFilterOpen ? (
          <ColumnFilterPopup
            filter={filter}
            totalCount={totalCount}
            visibleCount={count}
            onChange={onFilterChange}
            onClose={() => onFilterToggle('')}
          />
        ) : null}
      </div>
      <div className="receipt-list">
        {receipts.map((receipt) => (
          <button
            className={`receipt-card ${receipt.id === selectedReceiptId ? 'active' : ''} ${
              interactive ? '' : 'readonly'
            }`}
            key={receipt.id}
            type="button"
            onClick={() => interactive && onSelect(receipt.id)}
            disabled={!interactive}
          >
            <div className="receipt-card-head">
              <strong>{receipt.bankTransactionId}</strong>
              <span>{formatMoney(receipt.amount, receipt.currency)}</span>
            </div>
            <p>{receipt.payerName}</p>
            <small>{receipt.purpose}</small>
          </button>
        ))}
        {!receipts.length ? <p className="muted empty-column">Արդյունք չկա</p> : null}
      </div>
    </section>
  );
}

function ColumnFilterPopup({ filter, totalCount, visibleCount, onChange, onClose }) {
  function updateField(name, value) {
    onChange({ ...filter, [name]: value });
  }

  return (
    <div className="column-filter-popover">
      <div className="filter-popover-head">
        <strong>Ամսաթիվ</strong>
        <span>
          {visibleCount} / {totalCount}
        </span>
      </div>
      <div className="filter-date-grid">
        <label>
          <span>Սկսած</span>
          <input type="date" value={filter.dateFrom} onChange={(event) => updateField('dateFrom', event.target.value)} />
        </label>
        <label>
          <span>Մինչև</span>
          <input type="date" value={filter.dateTo} onChange={(event) => updateField('dateTo', event.target.value)} />
        </label>
      </div>
      <div className="filter-actions">
        <button className="secondary" type="button" onClick={() => onChange(createEmptyColumnFilter())}>
          Մաքրել
        </button>
        <button type="button" onClick={onClose}>
          <Check size={15} />
          Կիրառել
        </button>
      </div>
    </div>
  );
}

function getSuggestionId(suggestion) {
  return [suggestion.deal.id, suggestion.score, suggestion.label, ...(suggestion.scheduleIds ?? [])].join(':');
}

function createEmptyColumnFilter() {
  return {
    dateFrom: '',
    dateTo: ''
  };
}

function hasActiveColumnFilter(filter) {
  return Boolean(filter.dateFrom || filter.dateTo);
}

function isMatchedActivity(action) {
  return String(action ?? '').startsWith('Receipt matched with Deal #');
}

function isCreatedReceiptActivity(action) {
  return String(action ?? '') === 'Bank receipt was created in Bitrix';
}

function filterHistoryByDate(items, filter) {
  return items.filter((item) => {
    const dayKey = getArmenianDateKey(item.createdAt);

    if (!dayKey) {
      return false;
    }

    return (!filter.from || dayKey >= filter.from) && (!filter.to || dayKey <= filter.to);
  });
}

function getArmenianDateKey(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Yerevan',
    year: 'numeric'
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  return year && month && day ? `${year}-${month}-${day}` : '';
}

function formatActivityAction(action) {
  const value = String(action ?? '');
  const matchedDeal = value.match(/^Receipt matched with Deal #(.+); schedules recalculated$/);
  const syncCompleted = value.match(/^Ameriabank sync completed: (\d+) imported, (\d+) skipped$/);

  if (matchedDeal) {
    return `\u053f\u057f\u0580\u0578\u0576\u0568 \u0570\u0561\u0574\u0561\u057a\u0561\u057f\u0561\u057d\u056d\u0561\u0576\u0565\u0581\u057e\u0565\u0581 Deal #${matchedDeal[1]}-\u056b \u0570\u0565\u057f, \u057e\u0573\u0561\u0580\u0574\u0561\u0576 \u0563\u0580\u0561\u0586\u056b\u056f\u0568 \u057e\u0565\u0580\u0561\u0570\u0561\u0577\u057e\u0561\u0580\u056f\u057e\u0565\u0581`;
  }

  if (value === 'Bank receipt was created in Bitrix') {
    return '\u0532\u0561\u0576\u056f\u0561\u0575\u056b\u0576 \u056f\u057f\u0580\u0578\u0576\u0568 \u057d\u057f\u0565\u0572\u056e\u057e\u0565\u0581 Bitrix-\u0578\u0582\u0574';
  }

  if (syncCompleted) {
    return `Ameriabank-\u056b \u057d\u056b\u0576\u0584\u0580\u0578\u0576\u0561\u0581\u0578\u0582\u0574\u0568 \u0561\u057e\u0561\u0580\u057f\u057e\u0565\u0581. \u0576\u0565\u0580\u0574\u0578\u0582\u056e\u057e\u0565\u0581 ${syncCompleted[1]} \u056f\u057f\u0580\u0578\u0576, \u0562\u0561\u0581 \u0569\u0578\u0572\u0576\u057e\u0565\u0581 ${syncCompleted[2]}`;
  }

  return value;
}

function formatArmenianDateTime(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('hy-AM', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'Asia/Yerevan'
  }).format(date);
}

function filterReceipts(receipts, filter) {
  const fromTime = filter.dateFrom ? new Date(`${filter.dateFrom}T00:00:00`).getTime() : null;
  const toTime = filter.dateTo ? new Date(`${filter.dateTo}T23:59:59`).getTime() : null;

  return receipts
    .filter((receipt) => {
      const receiptDate = getReceiptDate(receipt);
      const receiptTime = receiptDate ? receiptDate.getTime() : null;
      const matchesFrom = !fromTime || (receiptTime && receiptTime >= fromTime);
      const matchesTo = !toTime || (receiptTime && receiptTime <= toTime);

      return matchesFrom && matchesTo;
    })
    .sort((left, right) => (getReceiptDate(right)?.getTime() ?? 0) - (getReceiptDate(left)?.getTime() ?? 0));
}

function getReceiptDate(receipt) {
  const value = receipt.paymentDate || receipt.receivedAt || receipt.parsed?.contractDate;

  if (!value) {
    return null;
  }

  if (/^\d{2}[./-]\d{2}[./-]\d{4}$/.test(value)) {
    const [day, month, year] = value.split(/[./-]/);
    return new Date(`${year}-${month}-${day}T00:00:00`);
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function ManualSearchModal({ deals, filters, loading, confirming, selectedDeal, onClose, onConfirm, onSearch, onSelectDeal }) {
  return (
    <div className="suggestion-modal-backdrop" role="presentation">
      <section className="manual-search-modal" role="dialog" aria-modal="true" aria-labelledby="manual-search-title">
        <div className="suggestion-modal-head">
          <div>
            <p className="eyebrow">Search</p>
            <h2 id="manual-search-title">Ձեռքով որոնում</h2>
          </div>
          <button className="secondary icon-button" type="button" onClick={onClose} aria-label="Փակել">
            ×
          </button>
        </div>

        <div className="manual-grid">
          <input
            placeholder="Ըստ անվան"
            value={filters.name}
            onChange={(event) => onSearch({ ...filters, name: event.target.value })}
          />
          <select
            aria-label="Շենք"
            value={filters.building}
            onChange={(event) => onSearch({ ...filters, building: event.target.value })}
          >
            <option value="">Բոլոր շենքերը</option>
            {BUILDING_OPTIONS.map((building) => (
              <option key={building.value} value={building.value}>
                {building.label}
              </option>
            ))}
          </select>
          <input
            placeholder="Բնակարան"
            value={filters.apartment}
            onChange={(event) => onSearch({ ...filters, apartment: event.target.value })}
          />
        </div>

        <div className="manual-results">
          {loading ? (
            <div className="manual-results-loading">
              <RefreshCw size={18} />
              <span>Որոնվում է</span>
            </div>
          ) : deals.map((deal) => (
            <label className="manual-result" key={deal.id}>
              <input checked={selectedDeal?.id === deal.id} onChange={() => onSelectDeal(deal)} type="checkbox" />
              <span className="manual-result-body">
                <span className="manual-result-title">
                  <strong>{deal.buyerName || deal.title || `Deal #${deal.id}`}</strong>
                  <em>Deal #{deal.id}</em>
                </span>
                <span className="manual-result-meta">
                  <span>
                    <small>Բնակարան</small>
                    <b>{deal.apartmentNumber || '-'}</b>
                  </span>
                  <span>
                    <small>Շենք</small>
                    <b>{getBuildingLabel(deal.projectId)}</b>
                  </span>
                  <span>
                    <small>Գումար</small>
                    <b>{deal.amount ? formatMoney(deal.amount, deal.currency) : '-'}</b>
                  </span>
                </span>
              </span>
            </label>
          ))}
          {!loading && !deals.length ? <p className="muted empty-column">Արդյունք չկա</p> : null}
        </div>

        <div className="suggestion-modal-actions">
          <button className="secondary" type="button" onClick={onClose}>
            Փակել
          </button>
          <button disabled={!selectedDeal || confirming} type="button" onClick={() => onConfirm({ dealId: selectedDeal.id })}>
            <Check size={16} />
            Կապել ձեռքով
          </button>
        </div>
      </section>
    </div>
  );
}

function ReceiptSidebar({
  receipt,
  loading,
  confirming,
  onDealView,
  onConfirm,
  onOpenManualSearch
}) {
  if (!receipt) {
    return (
      <div className="empty-state">
        <CheckCircle2 size={28} />
        <strong>{loading ? 'Բեռնվում է' : 'Բոլոր կտրոնները համապատասխանեցված են'}</strong>
      </div>
    );
  }

  const firstSuggestion = receipt.suggestions[0];

  return (
    <>
      <div className="sidebar-block">
        <div className="section-title">
          <Banknote size={18} />
          <h2>Ակտիվ կտրոն</h2>
        </div>
        <div className="receipt-summary">
          <strong>{formatMoney(receipt.amount, receipt.currency)}</strong>
          <span>{receipt.payerName}</span>
          <p>{receipt.purpose}</p>
          <ParsedBadges parsed={receipt.parsed} />
        </div>
      </div>

      <div className="sidebar-block smart-suggestions-block">
        <div className="section-title">
          <CheckCircle2 size={18} />
          <h2>Խելացի առաջարկներ</h2>
        </div>
        <div className="suggestion-list">
          {receipt.suggestions.map((suggestion) => (
            <article className="suggestion" key={getSuggestionId(suggestion)}>
              <div className="suggestion-body-button">
                <div className="suggestion-head">
                  <button className="deal-name-button" type="button" onClick={() => onDealView(suggestion.deal)}>
                    {suggestion.deal.buyerName}
                  </button>
                  <span>{suggestion.label}</span>
                </div>
                <p>{suggestion.deal.address}</p>
                <div className="suggestion-meta">
                  <span>Deal #{suggestion.deal.id}</span>
                  <span>Score {suggestion.score}</span>
                  {suggestion.deal.amount ? (
                    <span>{formatMoney(suggestion.deal.amount, suggestion.deal.currency)}</span>
                  ) : null}
                </div>
                <small>{suggestion.reason}</small>
                {suggestion.deal.showSchedulesInCard && suggestion.deal.schedules?.length ? (
                  <div className="schedule-preview">
                    {suggestion.deal.schedules.map((schedule) => (
                      <span key={schedule.id}>
                        #{schedule.id} · {formatMoney(schedule.amount, schedule.currency)} ·{' '}
                        {formatDate(schedule.paymentDate) || '-'} · {schedule.status}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <button
                disabled={confirming}
                type="button"
                onClick={() =>
                  onConfirm({
                    dealId: suggestion.deal.id,
                    scheduleIds: suggestion.scheduleIds
                  })
                }
              >
                <Check size={16} />
                Հաստատել
              </button>
            </article>
          ))}
          {!firstSuggestion ? <p className="muted">Առաջարկ չկա</p> : null}
        </div>
      </div>

      <div className="manual-search-entry">
        <button type="button" onClick={onOpenManualSearch}>
          <Search size={18} />
          Ձեռքով որոնում
        </button>
      </div>
    </>
  );
}

function DealDetailsModal({ deal, onClose }) {
  const fields = [
    ['Deal ID', `#${deal.id}`],
    ['Գործարք', deal.title || deal.address],
    ['Հաճախորդ', deal.buyerName],
    ['Contact ID', deal.contactId ? `#${deal.contactId}` : ''],
    ['Գումար', deal.amount ? formatMoney(deal.amount, deal.currency) : ''],
    ['Project', deal.projectName || deal.projectId],
    ['Building section', deal.buildingSectionId],
    ['Բնակարան', deal.apartmentNumber],
    ['Հարկ', deal.floor],
    ['Մակերես', deal.area],
    ['Գրաֆիկ IDs', deal.scheduleIds?.join(', ')]
  ].filter(([, value]) => value);

  return (
    <div className="suggestion-modal-backdrop" role="presentation">
      <section className="deal-details-modal" role="dialog" aria-modal="true" aria-labelledby="deal-details-title">
        <div className="suggestion-modal-head">
          <div>
            <p className="eyebrow">Deal Details</p>
            <h2 id="deal-details-title">{deal.buyerName || deal.title || `Deal #${deal.id}`}</h2>
          </div>
          <button className="secondary icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="deal-details-grid">
          {fields.map(([label, value]) => (
            <div className="deal-detail-field" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>

        <div className="deal-schedules-panel">
          <div className="section-title">
            <Banknote size={18} />
            <h3>{'\u054e\u0573\u0561\u0580\u0578\u0582\u0574\u0576\u0565\u0580\u056b \u0562\u0561\u0577\u056d\u0578\u0582\u0574'}</h3>
          </div>
          {deal.paymentTimeline?.length ? (
            <div className="payment-timeline">
              {deal.paymentTimeline.map((payment) => (
                <div className="payment-step" key={payment.receiptId}>
                  <div className="payment-step-head">
                    <strong>
                      {'\u053f\u057f\u0580\u0578\u0576 #'}
                      {payment.receiptId}
                    </strong>
                    <span>{formatMoney(payment.amount, payment.currency)}</span>
                    {payment.paymentDate ? <small>{formatDate(payment.paymentDate)}</small> : null}
                  </div>
                  {payment.allocations.map((allocation) => (
                    <div className="payment-allocation" key={`${payment.receiptId}-${allocation.scheduleId}`}>
                      <span>
                        #{allocation.scheduleId} · {formatDate(allocation.paymentDate) || '-'}
                      </span>
                      <strong>{formatMoney(allocation.paid, allocation.currency)}</strong>
                      <em>
                        {allocation.closed
                          ? '\u0553\u0561\u056f\u057e\u0565\u0581'
                          : `${'\u0544\u0576\u0561\u0581\u0578\u0580\u0564'} ${formatMoney(allocation.remainingAfter, allocation.currency)}`}
                      </em>
                    </div>
                  ))}
                  {payment.excess > 0 ? (
                    <div className="payment-allocation excess">
                      <span>{'\u0531\u057e\u0565\u056c\u0581\u0578\u0582\u056f'}</span>
                      <strong>{formatMoney(payment.excess, payment.currency)}</strong>
                      <em>{'\u0540\u0561\u057b\u0578\u0580\u0564 \u0563\u0580\u0561\u0586\u056b\u056f\u056b\u0576'}</em>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">{'\u054e\u0573\u0561\u0580\u0578\u0582\u0574 \u0579\u056f\u0561'}</p>
          )}
        </div>

        <div className="deal-schedules-panel">
          <div className="section-title">
            <CheckCircle2 size={18} />
            <h3>Գրաֆիկներ</h3>
          </div>
          {deal.schedules?.length ? (
            <div className="deal-schedule-list">
              {deal.schedules.map((schedule) => (
                <div className="deal-schedule-row" key={schedule.id}>
                  <strong>#{schedule.id}</strong>
                  <span>{formatMoney(schedule.amount, schedule.currency)}</span>
                  <span>{formatDate(schedule.paymentDate) || '-'}</span>
                  <span>{formatScheduleStatus(schedule.status)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Գրաֆիկ չկա</p>
          )}
        </div>
      </section>
    </div>
  );
}

function formatMoney(amount, currency) {
  return new Intl.NumberFormat('hy-AM').format(amount) + ` ${currency}`;
}

function getBuildingLabel(projectId) {
  return BUILDING_OPTIONS.find((building) => building.value === String(projectId ?? ''))?.label || projectId || '-';
}

function formatDate(value) {
  if (!value) {
    return '';
  }

  return new Date(value).toLocaleDateString('hy-AM');
}

function formatScheduleStatus(status) {
  if (status === 'DT1052_33:CLIENT') return '\u054e\u0573\u0561\u0580\u057e\u0561\u056e';
  if (status === 'DT1052_33:PREPARATION') return '\u0544\u0561\u057d\u0576\u0561\u056f\u056b \u057e\u0573\u0561\u0580\u057e\u0561\u056e';
  if (status === 'DT1052_33:NEW') return '\u0549\u057e\u0573\u0561\u0580\u057e\u0561\u056e';
  return status;
}

function ParsedBadges({ parsed }) {
  const fields = [
    ['Շենք', parsed.building],
    ['Բն.', parsed.apartment],
    ['5/1', parsed.addressNumber],
    ['Մուտք', parsed.entrance],
    ['Հարկ', parsed.floor],
    ['Նախ. համ.', parsed.preliminaryNumber],
    ['Գրանց.', parsed.registrationNumber],
    ['Պայմ. ամս.', parsed.contractDate],
    ['Մակ.', parsed.area],
    ['Project', parsed.project]
  ].filter(([, value]) => value);

  if (!fields.length) {
    return (
      <div className="badges">
        <span>Regex -</span>
      </div>
    );
  }

  return (
    <div className="badges">
      {fields.map(([label, value]) => (
        <span key={`${label}-${value}`}>
          {label} {value}
        </span>
      ))}
    </div>
  );
}
