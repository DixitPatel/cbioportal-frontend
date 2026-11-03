import * as React from 'react';
import { observer } from 'mobx-react';
import { PatientViewPageStore } from '../clinicalInformation/PatientViewPageStore';

const COPILOT_BASE_URL =
    typeof window !== 'undefined' && window.location.protocol === 'https:'
        ? ''
        : 'http://localhost:8000';

export interface IAskMuseFloatingWindowProps {
    store: PatientViewPageStore;
    onClose: () => void;
    // Active patient-view tab id (e.g. 'summary' | 'pathways' |
    // 'clinicalData' | 'pathologyReport'). Falls back to the URL when omitted.
    activeTab?: string;
}

type ChatRole = 'user' | 'assistant';

interface IPaper {
    pmid: string;
    title: string;
    source?: string;
    pubdate?: string;
}

interface IChatMessage {
    role: ChatRole;
    text: string;
    // Populated when the assistant response suggests an OncoTree mapping
    suggestedMapping?: any;
    // Populated by query_pubmed replies: selectable literature cards
    papers?: IPaper[];
    pubmedUrl?: string;
    query?: string;
    // PMIDs whose abstracts were ingested for a grounded synthesis
    groundedOn?: string[];
}

interface IQuickPrompt {
    action: string;
    label: string;
}

const DEFAULT_QUICK_PROMPTS: IQuickPrompt[] = [
    { action: 'map_oncotree', label: 'Map OncoTree' },
    { action: 'query_pubmed', label: 'Query PubMed' },
    { action: 'show_batch_failures', label: 'Show failures' },
    { action: 'colab_recipe', label: '🚀 Colab Cookbook' },
];

// Tab-contextual question pills (W7 contextual vision taxonomy). Keyed by
// patient-view tab id; unknown tabs fall back to the core prompts only.
const TAB_CONTEXT_PROMPTS: { [tab: string]: IQuickPrompt[] } = {
    summary: [
        { action: 'tmb_grade_paradox', label: 'TMB–grade paradox' },
        { action: 'survival_gap', label: 'PFS–stage gap' },
    ],
    timeline: [
        { action: 'fail_kinetics', label: '⏱️ Gemcitabine kinetics' },
        { action: 'survival_gap', label: 'PFS–stage gap' },
    ],
    pathways: [
        { action: 'cdkn2a_tp53_axis', label: 'CDKN2A–TP53 axis' },
        {
            action: 'ras_cellcycle_cooperation',
            label: 'KRAS–CDKN2A synergy',
        },
    ],
    clinicalData: [
        { action: 'tmb_grade_paradox', label: 'TMB–grade paradox' },
        { action: 'survival_gap', label: 'PFS–stage gap' },
    ],
    pathologyReport: [
        { action: 'pathology_r1_reconciliation', label: 'R1 margin story' },
        { action: 'angioinvasion_failure', label: 'Arterial invasion risk' },
    ],
};

function resolveActiveTab(explicitTab?: string): string {
    if (explicitTab) {
        return explicitTab;
    }
    if (typeof window === 'undefined') {
        return '';
    }
    // Prefer the patient-view `tab` query param, then the last path segment
    // (PatientViewUrlWrapper derives activeTabId from the pathname).
    try {
        const params = new URLSearchParams(window.location.search);
        const tabParam = params.get('tab');
        if (tabParam) {
            return tabParam;
        }
    } catch (e) {
        // fall through to pathname parsing
    }
    const parts = window.location.pathname.split('/').filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : '';
}

// Render inline [text](url) Markdown links as clickable anchors.
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
    const parts: React.ReactNode[] = [];
    const linkPattern = /\[([^\]]+)\]\(([^)\s]+)\)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let key = 0;
    while ((match = linkPattern.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push(text.slice(lastIndex, match.index));
        }
        parts.push(
            <a
                key={`${keyPrefix}-link-${key++}`}
                href={match[2]}
                target="_blank"
                rel="noopener noreferrer"
            >
                {match[1]}
            </a>
        );
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex));
    }
    return parts;
}

// Minimal Markdown-ish renderer: bullet/numbered lines become lists,
// [text](url) links become anchors, everything else renders as paragraphs.
// Intent: readable chat text without pulling in a Markdown dependency.
const ChatText: React.FunctionComponent<{ text: string }> = ({ text }) => {
    const lines = text.split('\n');
    const blocks: React.ReactNode[] = [];
    let listItems: React.ReactNode[][] = [];
    const flushList = (key: string) => {
        if (listItems.length > 0) {
            blocks.push(
                <ul key={key} style={{ margin: '4px 0', paddingLeft: 18 }}>
                    {listItems.map((item, i) => (
                        <li key={i}>{item}</li>
                    ))}
                </ul>
            );
            listItems = [];
        }
    };
    lines.forEach((line, i) => {
        const bullet = line.match(/^\s*[-*]\s+(.*)$/);
        const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
        if (bullet || numbered) {
            listItems.push(renderInline((bullet || numbered)![1], `li-${i}`));
        } else {
            flushList(`list-${i}`);
            if (line.trim().length > 0) {
                blocks.push(
                    <p key={`p-${i}`} style={{ margin: '4px 0' }}>
                        {renderInline(line, `p-${i}`)}
                    </p>
                );
            }
        }
    });
    flushList('list-end');
    return <>{blocks}</>;
};

const AskMuseFloatingWindow: React.FunctionComponent<
    IAskMuseFloatingWindowProps
> = observer(({ store, onClose, activeTab }) => {
    const [messages, setMessages] = React.useState<IChatMessage[]>([]);
    const [input, setInput] = React.useState('');
    const [isBusy, setIsBusy] = React.useState(false);
    const [indexStatus, setIndexStatus] = React.useState('');
    const [saveStatus, setSaveStatus] = React.useState('');
    // PMIDs selected per assistant message (message index -> pmids)
    const [selectedByMsg, setSelectedByMsg] = React.useState<{
        [msgIndex: number]: string[];
    }>({});
    // PMIDs whose abstracts were ingested via synthesize-pmids; sent with
    // follow-up chat so the backend answers grounded on those papers.
    const [ingestedPmids, setIngestedPmids] = React.useState<string[]>([]);
    const [synthesizeStatus, setSynthesizeStatus] = React.useState('');
    const threadRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        if (threadRef.current) {
            threadRef.current.scrollTop = threadRef.current.scrollHeight;
        }
    }, [messages]);

    const resolvedActiveTab = resolveActiveTab(activeTab);
    const quickPrompts: IQuickPrompt[] = [
        ...DEFAULT_QUICK_PROMPTS,
        ...(TAB_CONTEXT_PROMPTS[resolvedActiveTab] || []),
    ];

    // Study context extracted from the patient view store (read-only,
    // no fetch is triggered by reading these values).
    const studyId: string = store.studyId || '';
    const caseId: string = store.sampleId || store.patientId || '';
    const study =
        store.studyIdToStudy.isComplete && studyId
            ? (store.studyIdToStudy.result as any)[studyId]
            : undefined;
    // Prioritize the OncoTree code (e.g. PAAD) over the full name.
    const cancerType: string =
        (study &&
            (study.cancerTypeId ||
                study.cancerType?.shortName ||
                study.cancerType?.name)) ||
        '';
    const allMutations: any[] =
        store.mutationData.isComplete && store.mutationData.result
            ? (store.mutationData.result as any[])
            : [];
    // Resolve each mutation's real HGVS variant_id from the
    // AlphaGenome annotation indexes, falling back to a deterministic
    // chr:g.startRef>Alt id. All mutations are included (no truncation).
    const indexedAnnotations: { [genomicLocation: string]: any } =
        (store.indexedAlphaGenomeAnnotations.isComplete &&
        store.indexedAlphaGenomeAnnotations.result
            ? (store.indexedAlphaGenomeAnnotations.result as any)
            : {}) || {};
    const streamingAnnotations: { [genomicLocation: string]: any } =
        (store.streamingAlphaGenomeAnnotations as any) || {};
    const resolveVariantId = (m: any): string => {
        const key = `${m.chr},${m.startPosition},${m.endPosition},${m.referenceAllele},${m.variantAllele}`;
        const ann = indexedAnnotations[key] || streamingAnnotations[key];
        const hgvs = ann?.variant || ann?.hg38_variant;
        if (typeof hgvs === 'string' && hgvs.length > 0) {
            return hgvs;
        }
        return `${m.chr}:g.${m.startPosition}${m.referenceAllele}>${m.variantAllele}`;
    };
    const variants = allMutations.map(m => ({
        variant_id: resolveVariantId(m),
        hugo_symbol: m.gene?.hugoGeneSymbol || m.hugoGeneSymbol || 'UNKNOWN',
        protein_change: m.proteinChange || null,
    }));

    const postJson = async (path: string, body: any) => {
        const response = await fetch(`${COPILOT_BASE_URL}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            throw new Error(`Request failed (${response.status})`);
        }
        return response.json();
    };

    // actionType is null for free-text chat, or the quick-prompt
    // action string when clicking a pill. Sent as snake_case action_type.
    // Uses Server-Sent Events (SSE) via POST /copilot/chat/stream for real-time streaming.
    const sendChat = async (
        actionType: string | null,
        message: string
    ) => {
        const trimmed = message.trim();
        const isFreeText = actionType === null || actionType === 'chat';
        if (isBusy || (isFreeText && trimmed.length === 0)) {
            return;
        }
        setIsBusy(true);
        setSaveStatus('');
        const userText = isFreeText ? trimmed : `/${actionType} ${trimmed}`;
        // Append user turn and initial empty assistant turn for streaming
        setMessages(prev => [
            ...prev,
            { role: 'user', text: userText },
            { role: 'assistant', text: '' },
        ]);
        if (isFreeText) {
            setInput('');
        }

        const requestBody = {
            study_id: studyId,
            case_id: caseId,
            cancer_type: cancerType,
            active_tab: resolvedActiveTab,
            action_type: isFreeText ? null : actionType,
            message: trimmed,
            history: messages.map(m => ({
                role: m.role,
                content: m.text,
            })),
            variants,
            ingested_pmids: ingestedPmids,
        };

        try {
            const response = await fetch(`${COPILOT_BASE_URL}/copilot/chat/stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok || !response.body) {
                throw new Error(`Streaming error HTTP ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let accumulated = '';
            let lineBuffer = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                lineBuffer += decoder.decode(value, { stream: true });
                const lines = lineBuffer.split('\n');
                lineBuffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (!trimmedLine.startsWith('data:')) continue;
                    const jsonStr = trimmedLine.replace(/^data:\s*/, '');
                    if (!jsonStr) continue;
                    try {
                        const event = JSON.parse(jsonStr);
                        if (event.delta) {
                            accumulated += event.delta;
                            setMessages(prev => {
                                const copy = [...prev];
                                const last = copy[copy.length - 1];
                                if (last && last.role === 'assistant') {
                                    copy[copy.length - 1] = {
                                        ...last,
                                        text: accumulated,
                                    };
                                }
                                return copy;
                            });
                        }
                        if (event.done) {
                            const finalText = event.reply || accumulated;
                            setMessages(prev => {
                                const copy = [...prev];
                                const last = copy[copy.length - 1];
                                if (last && last.role === 'assistant') {
                                    copy[copy.length - 1] = {
                                        ...last,
                                        text: finalText,
                                        suggestedMapping: event.suggested_mapping,
                                        papers: event.papers,
                                        pubmedUrl: event.pubmed_url || event.pubmedUrl,
                                        query: event.query,
                                    };
                                }
                                return copy;
                            });
                        }
                    } catch (err) {
                        // ignore unparseable chunk
                    }
                }
            }
        } catch (streamErr: any) {
            // Fallback to non-streaming POST /copilot/chat
            try {
                const data = await postJson('/copilot/chat', requestBody);
                setMessages(prev => {
                    const copy = [...prev];
                    const last = copy[copy.length - 1];
                    if (last && last.role === 'assistant') {
                        copy[copy.length - 1] = {
                            role: 'assistant',
                            text: data.reply || data.message || JSON.stringify(data),
                            suggestedMapping: data.suggested_mapping,
                            papers: data.papers,
                            pubmedUrl: data.pubmed_url || data.pubmedUrl,
                            query: data.query,
                        };
                    }
                    return copy;
                });
            } catch (fallbackErr: any) {
                setMessages(prev => {
                    const copy = [...prev];
                    const last = copy[copy.length - 1];
                    if (last && last.role === 'assistant') {
                        copy[copy.length - 1] = {
                            role: 'assistant',
                            text: `Co-Pilot request failed: ${fallbackErr?.message || streamErr?.message || fallbackErr}`,
                        };
                    }
                    return copy;
                });
            }
        } finally {
            setIsBusy(false);
        }
    };

    const togglePmid = (msgIndex: number, pmid: string) => {
        setSelectedByMsg(prev => {
            const current = prev[msgIndex] || [];
            const next = current.includes(pmid)
                ? current.filter(p => p !== pmid)
                : [...current, pmid];
            return { ...prev, [msgIndex]: next };
        });
    };

    const synthesizePmids = async (msgIndex: number) => {
        const selected = selectedByMsg[msgIndex] || [];
        if (isBusy || selected.length === 0) {
            return;
        }
        setIsBusy(true);
        setSynthesizeStatus('Synthesizing…');
        try {
            const data = await postJson('/copilot/synthesize-pmids', {
                pmids: selected,
                question: input.trim(),
                study_id: studyId,
                case_id: caseId,
                cancer_type: cancerType,
                variants,
            });
            const grounded: string[] = data.pmids || selected;
            setIngestedPmids(prev =>
                Array.from(new Set([...prev, ...grounded]))
            );
            setMessages(prev => [
                ...prev,
                {
                    role: 'assistant',
                    text:
                        data.synthesis ||
                        data.reply ||
                        data.message ||
                        JSON.stringify(data),
                    groundedOn: grounded,
                },
            ]);
            setSynthesizeStatus('');
        } catch (e: any) {
            setSynthesizeStatus(`Synthesis failed: ${e?.message || e}`);
        } finally {
            setIsBusy(false);
        }
    };

    const indexSample = async () => {
        if (isBusy) {
            return;
        }
        setIsBusy(true);
        setIndexStatus('Indexing…');
        try {
            const data = await postJson('/copilot/index-sample', {
                study_id: studyId,
                case_id: caseId,
                cancer_type: cancerType,
                variants,
            });
            // indexed_count (number) drives the status text.
            const count =
                data.indexed_count ??
                (Array.isArray(data.genes_indexed)
                    ? data.genes_indexed.length
                    : '?');
            setIndexStatus(`Indexed ${count} variant(s)`);
        } catch (e: any) {
            setIndexStatus(`Index failed: ${e?.message || e}`);
        } finally {
            setIsBusy(false);
        }
    };

    const saveMapping = async (suggestedMapping: any) => {
        if (isBusy || !suggestedMapping) {
            return;
        }
        setIsBusy(true);
        setSaveStatus('Saving…');
        try {
            await postJson('/copilot/save-mapping', suggestedMapping);
            setSaveStatus('Mapping saved');
        } catch (e: any) {
            setSaveStatus(`Save failed: ${e?.message || e}`);
        } finally {
            setIsBusy(false);
        }
    };

    return (
        <div
            data-test="AskMuseFloatingWindow"
            style={{
                position: 'fixed',
                bottom: 24,
                right: 24,
                width: 440,
                height: 560,
                zIndex: 9999,
                backgroundColor: '#fff',
                border: '1px solid #d9d9d9',
                borderRadius: 8,
                boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
            }}
        >
            <div
                style={{
                    padding: '8px 12px',
                    borderBottom: '1px solid #eee',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                }}
            >
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 'bold' }}>
                        🧬 Ask Muse Co-Pilot
                    </div>
                    <div
                        style={{
                            fontSize: 11,
                            color: '#666',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                        }}
                        title={`${studyId} / ${cancerType} / ${caseId}`}
                    >
                        {studyId}
                        {cancerType ? ` · ${cancerType}` : ''} · {caseId}
                    </div>
                    {indexStatus && (
                        <div style={{ fontSize: 11, color: '#666' }}>
                            {indexStatus}
                        </div>
                    )}
                    {ingestedPmids.length > 0 && (
                        <div style={{ fontSize: 11, color: '#2a7a2a' }}>
                            📚 Grounded on {ingestedPmids.length} paper(s)
                        </div>
                    )}
                </div>
                <button
                    className="btn btn-default btn-xs"
                    onClick={indexSample}
                    disabled={isBusy}
                    title="Index this sample into the Co-Pilot knowledge store"
                >
                    🔄 Index Sample
                </button>
                <button
                    className="btn btn-default btn-xs"
                    onClick={onClose}
                    title="Close Ask Muse Co-Pilot"
                >
                    ×
                </button>
            </div>
            <div
                ref={threadRef}
                style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '8px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                }}
            >
                {messages.length === 0 && (
                    <div style={{ color: '#888', fontSize: 12 }}>
                        Ask about this sample&apos;s AlphaGenome scores,
                        OncoTree mapping, batch failures, or literature
                        context. Nothing is fetched until you send a message
                        or tap a quick prompt.
                    </div>
                )}
                {messages.map((m, i) => (
                    <div
                        key={i}
                        style={{
                            alignSelf:
                                m.role === 'user' ? 'flex-end' : 'flex-start',
                            background:
                                m.role === 'user' ? '#eef4ff' : '#f7f7f7',
                            border: '1px solid #e3e3e3',
                            borderRadius: 6,
                            padding: '6px 8px',
                            maxWidth: '90%',
                            fontSize: 12,
                            whiteSpace: 'normal',
                        }}
                    >
                        <ChatText text={m.text} />
                        {m.groundedOn && m.groundedOn.length > 0 && (
                            <div
                                style={{
                                    marginTop: 4,
                                    fontSize: 11,
                                    color: '#2a7a2a',
                                }}
                            >
                                📚 Grounded on {m.groundedOn.join(', ')}
                            </div>
                        )}
                        {m.role === 'assistant' && m.suggestedMapping && (
                            <div style={{ marginTop: 6 }}>
                                <button
                                    className="btn btn-default btn-xs"
                                    onClick={() =>
                                        saveMapping(m.suggestedMapping)
                                    }
                                    disabled={isBusy}
                                    title="Save suggested OncoTree mapping"
                                >
                                    💾 Save Mapping
                                </button>
                            </div>
                        )}
                        {m.role === 'assistant' &&
                            m.papers &&
                            m.papers.length > 0 && (
                                <div style={{ marginTop: 6 }}>
                                    {m.query && (
                                        <div
                                            style={{
                                                fontSize: 11,
                                                color: '#555',
                                                marginBottom: 4,
                                                wordBreak: 'break-all',
                                            }}
                                        >
                                            {m.query}
                                        </div>
                                    )}
                                    {m.pubmedUrl && (
                                        <div style={{ marginBottom: 4 }}>
                                            <a
                                                href={m.pubmedUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                Open query on PubMed
                                            </a>
                                        </div>
                                    )}
                                    {m.papers.map(paper => {
                                        const checked = (
                                            selectedByMsg[i] || []
                                        ).includes(paper.pmid);
                                        return (
                                            <label
                                                key={paper.pmid}
                                                style={{
                                                    display: 'flex',
                                                    gap: 6,
                                                    alignItems: 'flex-start',
                                                    border:
                                                        '1px solid #e0e0e0',
                                                    borderRadius: 4,
                                                    padding: '4px 6px',
                                                    marginBottom: 4,
                                                    background: '#fff',
                                                    cursor: 'pointer',
                                                }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    onChange={() =>
                                                        togglePmid(
                                                            i,
                                                            paper.pmid
                                                        )
                                                    }
                                                    aria-label={`Select PMID ${paper.pmid}`}
                                                />
                                                <span>
                                                    <a
                                                        href={`https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        onClick={e =>
                                                            e.stopPropagation()
                                                        }
                                                    >
                                                        PMID {paper.pmid}
                                                    </a>
                                                    {paper.title
                                                        ? ` — ${paper.title}`
                                                        : ''}
                                                    {(paper.source ||
                                                        paper.pubdate) && (
                                                        <span
                                                            style={{
                                                                color: '#888',
                                                            }}
                                                        >
                                                            {paper.source
                                                                ? ` (${paper.source}`
                                                                : ' ('}
                                                            {paper.pubdate
                                                                ? ` ${paper.pubdate}`
                                                                : ''}
                                                            )
                                                        </span>
                                                    )}
                                                </span>
                                            </label>
                                        );
                                    })}
                                    <button
                                        className="btn btn-primary btn-xs"
                                        onClick={() => synthesizePmids(i)}
                                        disabled={
                                            isBusy ||
                                            (selectedByMsg[i] || []).length ===
                                                0
                                        }
                                        title="Synthesize the selected papers with Meta Wonder"
                                    >
                                        Synthesize Selected Papers
                                    </button>
                                </div>
                            )}
                    </div>
                ))}
                {saveStatus && (
                    <div style={{ fontSize: 11, color: '#666' }}>
                        {saveStatus}
                    </div>
                )}
                {synthesizeStatus && (
                    <div style={{ fontSize: 11, color: '#666' }}>
                        {synthesizeStatus}
                    </div>
                )}
            </div>
            <div
                style={{
                    borderTop: '1px solid #eee',
                    padding: '8px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                }}
            >
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {quickPrompts.map(p => (
                        <button
                            key={p.action}
                            className="btn btn-default btn-xs"
                            onClick={() => sendChat(p.action, p.label)}
                            disabled={isBusy}
                            title={`Ask Co-Pilot: ${p.label}`}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                    <input
                        className="form-control input-sm"
                        style={{ flex: 1 }}
                        placeholder="Ask Muse about this sample…"
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                sendChat(null, input);
                            }
                        }}
                    />
                    <button
                        className="btn btn-primary btn-sm"
                        onClick={() => sendChat(null, input)}
                        disabled={isBusy || input.trim().length === 0}
                        title="Send chat message to Co-Pilot"
                    >
                        Send
                    </button>
                </div>
            </div>
        </div>
    );
});

export default AskMuseFloatingWindow;
