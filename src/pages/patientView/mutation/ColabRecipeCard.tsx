import * as React from 'react';

// One AlphaGenome-scored variant the user can open in the Colab Cookbook.
export interface IColabVariant {
    variantId: string;
    gene: string;
    proteinChange?: string;
    level?: string | null;
    merged?: number | null;
}

interface IColabParams {
    gene: string;
    hg38_variant: string;
    ontology_terms: string[];
    tissue_label: string;
    param_cell: string;
    colab_url: string;
    // 'published' on first use (the sidecar pushed the notebook to GitHub)
    notebook_status?: string;
}

const LEVEL_RANK: { [level: string]: number } = { strong: 0, moderate: 1 };

export function sortColabVariants(variants: IColabVariant[]): IColabVariant[] {
    return [...variants].sort(
        (a, b) =>
            (LEVEL_RANK[a.level || ''] ?? 2) -
                (LEVEL_RANK[b.level || ''] ?? 2) ||
            (b.merged ?? -1) - (a.merged ?? -1)
    );
}

function variantLabel(v: IColabVariant): string {
    const merged = v.merged == null ? '' : ` · splice ${v.merged.toFixed(3)}`;
    return `${v.gene} ${v.proteinChange || v.variantId} · ${v.level ||
        'no level'}${merged}`;
}

const ColabRecipeCard: React.FunctionComponent<{
    baseUrl: string;
    variants: IColabVariant[];
    oncotreeCode: string;
}> = ({ baseUrl, variants, oncotreeCode }) => {
    const sorted = React.useMemo(() => sortColabVariants(variants), [variants]);
    const [selected, setSelected] = React.useState('');
    const [params, setParams] = React.useState<IColabParams | null>(null);
    const [status, setStatus] = React.useState('');

    const pick = async (variantId: string) => {
        setSelected(variantId);
        setParams(null);
        if (!variantId) {
            return;
        }
        setStatus('Loading…');
        try {
            const response = await fetch(`${baseUrl}/copilot/colab-params`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    variant_id: variantId,
                    oncotree_code: oncotreeCode,
                    protein_change:
                        variants.find(v => v.variantId === variantId)
                            ?.proteinChange || null,
                }),
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data?.detail || `HTTP ${response.status}`);
            }
            setParams(data);
            setStatus('');
        } catch (e) {
            setStatus(`Could not build cell 4: ${e?.message || e}`);
        }
    };

    const copy = async () => {
        if (!params) {
            return;
        }
        try {
            await navigator.clipboard.writeText(params.param_cell);
            setStatus('Cell 4 copied.');
        } catch (e) {
            setStatus(`Copy failed: ${e?.message || e}`);
        }
    };

    if (sorted.length === 0) {
        return (
            <div data-test="ColabRecipeCard">
                <strong>Colab Cookbook</strong>
                <p style={{ margin: '4px 0' }}>
                    No AlphaGenome scores yet. Score variants first (⚡
                    AlphaGenome Score Variants).
                </p>
            </div>
        );
    }

    return (
        <div data-test="ColabRecipeCard">
            <strong>Colab Cookbook</strong>
            <div style={{ margin: '4px 0' }}>
                <select
                    className="form-control input-sm"
                    value={selected}
                    onChange={e => pick(e.target.value)}
                    aria-label="Pick a variant for the Colab Cookbook"
                >
                    <option value="">Pick a variant…</option>
                    {sorted.map(v => (
                        <option key={v.variantId} value={v.variantId}>
                            {variantLabel(v)}
                        </option>
                    ))}
                </select>
            </div>
            {params && (
                <>
                    <div style={{ fontSize: 11, color: '#555' }}>
                        {params.gene} {params.hg38_variant} · tissue{' '}
                        {params.tissue_label} (
                        {params.ontology_terms.join(', ')})
                    </div>
                    <pre
                        style={{
                            fontSize: 10,
                            maxHeight: 140,
                            overflow: 'auto',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                            margin: '4px 0',
                        }}
                    >
                        {params.param_cell}
                    </pre>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <button
                            className="btn btn-default btn-xs"
                            onClick={copy}
                        >
                            Copy cell 4
                        </button>
                        <a
                            className="btn btn-primary btn-xs"
                            href={params.colab_url}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Open in Colab ↗
                        </a>
                    </div>
                    {params.notebook_status === 'published' && (
                        <div
                            style={{
                                fontSize: 11,
                                color: '#2a7a2a',
                                marginTop: 4,
                            }}
                        >
                            First use: the notebook was published to GitHub.
                        </div>
                    )}
                    <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                        In Colab: enter your API key in cell 2 (or set the
                        secret ALPHA_GENOME_API_KEY), run cells 1–3, paste into
                        cell 4, run cells 4–7.
                    </div>
                </>
            )}
            {status && (
                <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                    {status}
                </div>
            )}
        </div>
    );
};

export default ColabRecipeCard;
