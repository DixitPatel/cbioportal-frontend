import * as React from 'react';
import { observer } from 'mobx-react';
import { PatientViewPageStore } from '../clinicalInformation/PatientViewPageStore';

const COPILOT_BASE_URL = 'http://localhost:8000';

export interface IAskMuseFloatingWindowProps {
    store: PatientViewPageStore;
    onClose: () => void;
}

type ChatRole = 'user' | 'assistant';

interface IChatMessage {
    role: ChatRole;
    text: string;
    // Populated when the assistant response suggests an OncoTree mapping
    suggestedMapping?: any;
}

interface IQuickPrompt {
    action: string;
    label: string;
}

const QUICK_PROMPTS: IQuickPrompt[] = [
    { action: 'map_oncotree', label: 'Map OncoTree' },
    { action: 'cross_reference_genes', label: 'Cross-reference genes' },
    { action: 'show_batch_failures', label: 'Show batch failures' },
    { action: 'prep_literature_context', label: 'Prep literature context' },
];

// Minimal Markdown-ish renderer: bullet/numbered lines become lists,
// everything else renders as paragraphs. Intent: readable chat text
// without pulling in a Markdown dependency.
const ChatText: React.FunctionComponent<{ text: string }> = ({ text }) => {
    const lines = text.split('\n');
    const blocks: React.ReactNode[] = [];
    let listItems: string[] = [];
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
            listItems.push((bullet || numbered)![1]);
        } else {
            flushList(`list-${i}`);
            if (line.trim().length > 0) {
                blocks.push(
                    <p key={`p-${i}`} style={{ margin: '4px 0' }}>
                        {line}
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
> = observer(({ store, onClose }) => {
    const [messages, setMessages] = React.useState<IChatMessage[]>([]);
    const [input, setInput] = React.useState('');
    const [isBusy, setIsBusy] = React.useState(false);
    const [indexStatus, setIndexStatus] = React.useState('');
    const [saveStatus, setSaveStatus] = React.useState('');
    const threadRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        if (threadRef.current) {
            threadRef.current.scrollTop = threadRef.current.scrollHeight;
        }
    }, [messages]);

    // Study context extracted from the patient view store (read-only,
    // no fetch is triggered by reading these values).
    const studyId: string = store.studyId || '';
    const caseId: string = store.sampleId || store.patientId || '';
    const study =
        store.studyIdToStudy.isComplete && studyId
            ? (store.studyIdToStudy.result as any)[studyId]
            : undefined;
    // Fix 3: prioritize the OncoTree code (e.g. PAAD) over the full name.
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
    // Fix 2: resolve each mutation's real HGVS variant_id from the
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
        const ann =
            indexedAnnotations[key] || streamingAnnotations[key];
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

    // Fix 1: actionType is null for free-text chat, or the quick-prompt
    // action string when clicking a pill. Sent as snake_case action_type.
    const sendChat = async (
        actionType: string | null,
        message: string
    ) => {
        const trimmed = message.trim();
        const isFreeText =
            actionType === null || actionType === 'chat';
        if (isBusy || (isFreeText && trimmed.length === 0)) {
            return;
        }
        setIsBusy(true);
        setSaveStatus('');
        const userText = isFreeText ? trimmed : `/${actionType} ${trimmed}`;
        setMessages(prev => [...prev, { role: 'user', text: userText }]);
        if (isFreeText) {
            setInput('');
        }
        try {
            const data = await postJson('/copilot/chat', {
                study_id: studyId,
                case_id: caseId,
                cancer_type: cancerType,
                action_type: isFreeText ? null : actionType,
                message: trimmed,
                history: messages.map(m => ({
                    role: m.role,
                    content: m.text,
                })),
                variants,
            });
            setMessages(prev => [
                ...prev,
                {
                    role: 'assistant',
                    text: data.reply || data.message || JSON.stringify(data),
                    suggestedMapping: data.suggested_mapping,
                },
            ]);
        } catch (e: any) {
            setMessages(prev => [
                ...prev,
                {
                    role: 'assistant',
                    text: `Co-Pilot request failed: ${e?.message || e}`,
                },
            ]);
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
            // Fix 7a: indexed_count (number) drives the status text.
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
                    </div>
                ))}
                {saveStatus && (
                    <div style={{ fontSize: 11, color: '#666' }}>
                        {saveStatus}
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
                <div
                    style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
                >
                    {QUICK_PROMPTS.map(p => (
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
