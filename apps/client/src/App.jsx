import React, { useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  Check,
  CheckCircle2,
  Clock3,
  Cloud,
  Filter,
  Link2,
  RefreshCw,
  Search
} from 'lucide-react';
import {
  confirmMatch,
  getHealth,
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
  const [health, setHealth] = useState(null);
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

  async function refreshData() {
    setLoading(true);
    setError('');

    try {
      const healthData = await getHealth();
      setHealth(healthData);
    } catch (err) {
      setError(err.message);
    }

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

  async function handleConfirm({ receiptId = selectedReceipt?.id, dealId, scheduleIds }) {
    setError('');

    try {
      await confirmMatch({
        receiptId,
        dealId,
        scheduleIds
      });
      setSelectedDeal(null);
      setManualDeals([]);
      await refreshData();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAcceptSuggestion() {
    if (!activeReceipt || !selectedModalSuggestion) {
      return;
    }

    setSuggestionAccepting(true);

    try {
      await handleConfirm({
        receiptId: activeReceipt.id,
        dealId: selectedModalSuggestion.deal.id,
        scheduleIds: selectedModalSuggestion.scheduleIds
      });
      setReceiptQueueIndex(0);
      setSelectedSuggestionId('');
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
          <StatusPill icon={<Cloud size={16} />} label="Backend" value={health?.ok ? 'Online' : 'Checking'} />
          <StatusPill
            icon={<Link2 size={16} />}
            label="Bitrix24"
            value={health?.bitrix?.configured ? 'Webhook OK' : 'No webhook'}
          />
          <button className="icon-button" type="button" onClick={refreshData} aria-label="Refresh">
            <RefreshCw size={18} />
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
            onConfirm={handleConfirm}
            onOpenManualSearch={() => setManualSearchOpen(true)}
          />
        </aside>
      </section>

      <section className="activity">
        <div className="section-title">
          <Clock3 size={18} />
          <h2>Գործողությունների պատմություն</h2>
        </div>
        <div className="activity-list">
          {board.log.map((item) => (
            <div className="activity-row" key={item.id}>
              <span>{new Date(item.createdAt).toLocaleString('hy-AM')}</span>
              <strong>{item.receiptId}</strong>
              <p>{item.action}</p>
            </div>
          ))}
        </div>
      </section>

      {activeReceipt ? (
        <SuggestionModal
          receipt={activeReceipt}
          accepting={suggestionAccepting}
          index={receiptQueueIndex}
          selectedSuggestionId={selectedSuggestionId || getSuggestionId(activeReceipt.suggestions[0])}
          total={receiptQueue.length}
          onAccept={handleAcceptSuggestion}
          onSelectSuggestion={setSelectedSuggestionId}
          onSkip={handleSkipReceiptSuggestions}
        />
      ) : null}
      {manualSearchOpen ? (
        <ManualSearchModal
          deals={manualDeals}
          filters={manualFilters}
          loading={manualSearchLoading}
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
                    <strong>{suggestion.deal.buyerName}</strong>
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
function StatusPill({ icon, label, value }) {
  return (
    <div className="status-pill">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
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

function ManualSearchModal({ deals, filters, loading, selectedDeal, onClose, onConfirm, onSearch, onSelectDeal }) {
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
              <span>
                <strong>{deal.buyerName}</strong>
                {deal.address}
              </span>
            </label>
          ))}
          {!loading && !deals.length ? <p className="muted empty-column">Արդյունք չկա</p> : null}
        </div>

        <div className="suggestion-modal-actions">
          <button className="secondary" type="button" onClick={onClose}>
            Փակել
          </button>
          <button disabled={!selectedDeal} type="button" onClick={() => onConfirm({ dealId: selectedDeal.id })}>
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
              <div>
                <div className="suggestion-head">
                  <strong>{suggestion.deal.buyerName}</strong>
                  <span>{suggestion.label}</span>
                </div>
                <p>{suggestion.deal.address}</p>
                <div className="suggestion-meta">
                  <span>Deal #{suggestion.deal.id}</span>
                  <span>Score {suggestion.score}</span>
                  {suggestion.deal.amount ? (
                    <span>{formatMoney(suggestion.deal.amount, suggestion.deal.currency)}</span>
                  ) : null}
                  {suggestion.scheduleIds?.length ? <span>Schedule {suggestion.scheduleIds.join(', ')}</span> : null}
                </div>
                <small>{suggestion.reason}</small>
                {suggestion.deal.schedules?.length ? (
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

function formatMoney(amount, currency) {
  return new Intl.NumberFormat('hy-AM').format(amount) + ` ${currency}`;
}

function formatDate(value) {
  if (!value) {
    return '';
  }

  return new Date(value).toLocaleDateString('hy-AM');
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
