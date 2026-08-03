import { buildFilterPills, FilterPillInput } from '@/utils/filterPills';

const baseInput: FilterPillInput = {
  filters: {},
  dateFrom: '',
  dateTo: '',
  selectedFalsePositiveTypes: [],
  selectedSmokeTypes: [],
  selectedModelAccuracy: 'all',
  selectedUnsure: 'all',
  showModelAccuracy: false,
  showFalsePositiveTypes: false,
  showSmokeTypes: false,
  showUnsureFilter: false,
  sourceApis: [{ id: 'alert_api', name: 'Alert API' }],
};

describe('buildFilterPills', () => {
  it('returns no pills when nothing is active', () => {
    expect(buildFilterPills(baseInput)).toEqual([]);
  });

  it('builds camera and organization pills from filter values', () => {
    const pills = buildFilterPills({
      ...baseInput,
      filters: { camera_name: 'marguerite-29', organisation_name: 'Pyronear FR' },
    });
    expect(pills).toEqual([
      { id: 'camera', label: 'Camera: marguerite-29' },
      { id: 'organization', label: 'Org: Pyronear FR' },
    ]);
  });

  it('resolves the source pill label from sourceApis', () => {
    const pills = buildFilterPills({ ...baseInput, filters: { source_api: 'alert_api' } });
    expect(pills).toEqual([{ id: 'source', label: 'Source: Alert API' }]);
  });

  it('labels alert API annotation values, including null as Unclassified', () => {
    expect(
      buildFilterPills({ ...baseInput, filters: { is_wildfire_alertapi: 'wildfire_smoke' } })
    ).toEqual([{ id: 'wildfire', label: 'Alert API: Wildfire Smoke' }]);
    expect(buildFilterPills({ ...baseInput, filters: { is_wildfire_alertapi: null } })).toEqual([
      { id: 'wildfire', label: 'Alert API: Unclassified' },
    ]);
  });

  it('gates accuracy and unsure pills behind their show flags', () => {
    const active = {
      ...baseInput,
      selectedModelAccuracy: 'false_positive' as const,
      selectedUnsure: 'unsure' as const,
    };
    expect(buildFilterPills(active)).toEqual([]);
    expect(
      buildFilterPills({ ...active, showModelAccuracy: true, showUnsureFilter: true })
    ).toEqual([
      { id: 'accuracy', label: 'Accuracy: False Positive' },
      { id: 'unsure', label: 'Only Unsure' },
    ]);
  });

  it('labels a preset date range as Last N days', () => {
    // Build dates matching the 7d preset relative to today, since
    // detectActivePreset compares against new Date().
    const today = new Date();
    const from = new Date(today);
    from.setDate(from.getDate() - 7);
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate()
      ).padStart(2, '0')}`;
    const pills = buildFilterPills({ ...baseInput, dateFrom: fmt(from), dateTo: fmt(today) });
    expect(pills).toEqual([{ id: 'date', label: 'Last 7 days' }]);
  });

  it('labels custom and open-ended date ranges', () => {
    expect(
      buildFilterPills({ ...baseInput, dateFrom: '2026-01-01', dateTo: '2026-01-15' })
    ).toEqual([{ id: 'date', label: '2026-01-01 – 2026-01-15' }]);
    expect(buildFilterPills({ ...baseInput, dateFrom: '2026-01-01' })).toEqual([
      { id: 'date', label: 'From 2026-01-01' },
    ]);
    expect(buildFilterPills({ ...baseInput, dateTo: '2026-01-15' })).toEqual([
      { id: 'date', label: 'Until 2026-01-15' },
    ]);
  });

  it('shows a single multi-select value by name and multiple as a count', () => {
    expect(
      buildFilterPills({
        ...baseInput,
        showFalsePositiveTypes: true,
        selectedFalsePositiveTypes: ['antenna'],
      })
    ).toEqual([{ id: 'falsePositiveTypes', label: 'FP type: Antenna' }]);
    expect(
      buildFilterPills({
        ...baseInput,
        showFalsePositiveTypes: true,
        showSmokeTypes: true,
        selectedFalsePositiveTypes: ['antenna', 'building', 'cliff'],
        selectedSmokeTypes: ['wildfire', 'industrial'],
      })
    ).toEqual([
      { id: 'falsePositiveTypes', label: 'FP types (3)' },
      { id: 'smokeTypes', label: 'Smoke types (2)' },
    ]);
  });
});
