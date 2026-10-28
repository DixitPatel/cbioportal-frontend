import React from 'react';
import { DefaultTooltip } from 'cbioportal-frontend-commons';
import {
    AlphaGenomeAnnotation,
    AlphaGenomeScore,
} from 'genome-nexus-ts-api-client';
import annotationStyles from '../column/annotation.module.scss';
import { defaultCurieForCancerType } from './oncotreeToUberon';

export const OUTPUT_TYPES = [
    'RNA_SEQ',
    'SPLICE_SITES',
    'SPLICE_SITE_USAGE',
    'SPLICE_JUNCTIONS',
] as const;

export type AlphaGenomeOutputType = typeof OUTPUT_TYPES[number];

export type AlphaGenomeLabel = 'strong' | 'moderate' | undefined;

export const DISCLAIMER = 'Model prediction, not experimental evidence.';

/**
 * Dual-gate UI label (project-defined thresholds): a score only counts when
 * |quantile_score| >= 0.99 AND the raw score passes its minimum
 * (|LFC| >= 0.5 strong / >= 0.1 moderate for RNA_SEQ;
 * delta >= 0.5 strong / >= 0.2 moderate for splicing scorers).
 */
export function scoreLevel(
    outputType: string | undefined,
    rawScore: number | undefined | null,
    quantileScore: number | undefined | null
): AlphaGenomeLabel {
    if (rawScore == null || quantileScore == null) {
        return undefined;
    }
    if (Math.abs(quantileScore) < 0.99) {
        return undefined;
    }
    if (outputType === 'RNA_SEQ') {
        if (Math.abs(rawScore) >= 0.5) {
            return 'strong';
        }
        if (Math.abs(rawScore) >= 0.1) {
            return 'moderate';
        }
        return undefined;
    }
    if (rawScore >= 0.5) {
        return 'strong';
    }
    if (rawScore >= 0.2) {
        return 'moderate';
    }
    return undefined;
}

/**
 * Cell label for the selected tissue: the best dual-gate level across rows
 * matching the tissue, plus tissue-independent SPLICE_SITES rows.
 */
export function alphaGenomeLabel(
    annotation: AlphaGenomeAnnotation | undefined,
    ontologyCurie?: string
): AlphaGenomeLabel {
    const rows = annotation?.annotation?.scores ?? [];
    let best: AlphaGenomeLabel = undefined;
    for (const row of rows) {
        const tissueAgnostic = row.output_type === 'SPLICE_SITES';
        if (!tissueAgnostic && ontologyCurie && row.ontology_curie !== ontologyCurie) {
            continue;
        }
        const level = scoreLevel(row.output_type, row.raw_score, row.quantile_score);
        if (level === 'strong') {
            return 'strong';
        }
        if (level === 'moderate') {
            best = 'moderate';
        }
    }
    return best;
}

export function sortValue(
    annotation: AlphaGenomeAnnotation | undefined,
    ontologyCurie?: string
): number {
    const label = alphaGenomeLabel(annotation, ontologyCurie);
    return label === 'strong' ? 0 : label === 'moderate' ? 1 : 2;
}

function availableCuries(rows: AlphaGenomeScore[]): string[] {
    const curies: string[] = [];
    for (const row of rows) {
        if (row.ontology_curie && !curies.includes(row.ontology_curie)) {
            curies.push(row.ontology_curie);
        }
    }
    return curies;
}

function rowForOutputType(
    rows: AlphaGenomeScore[],
    outputType: string,
    ontologyCurie?: string
): AlphaGenomeScore | undefined {
    const typed = rows.filter(row => row.output_type === outputType);
    if (typed.length === 0) {
        return undefined;
    }
    const match = ontologyCurie
        ? typed.find(row => row.ontology_curie === ontologyCurie)
        : undefined;
    if (match) {
        return match;
    }
    return typed.reduce((best, row) =>
        Math.abs(row.raw_score ?? 0) > Math.abs(best.raw_score ?? 0) ? row : best
    );
}

function TissueBarChart(props: {
    rows: AlphaGenomeScore[];
    outputType: string;
    selectedCurie?: string;
    onSelect: (curie: string) => void;
}): JSX.Element | null {
    if (props.outputType === 'SPLICE_SITES') {
        return null;
    }
    const byCurie = new Map<string, number>();
    for (const row of props.rows) {
        if (row.output_type !== props.outputType || !row.ontology_curie) {
            continue;
        }
        const current = byCurie.get(row.ontology_curie);
        const value = Math.abs(row.raw_score ?? 0);
        if (current === undefined || value > current) {
            byCurie.set(row.ontology_curie, value);
        }
    }
    const entries = Array.from(byCurie.entries());
    if (entries.length === 0) {
        return null;
    }
    const max = Math.max(...entries.map(([, value]) => value), 0.0001);
    return (
        <div style={{ marginTop: 8 }}>
            <div>
                <strong>{props.outputType} by tissue</strong>
            </div>
            {entries.map(([curie, value]) => (
                <div
                    key={curie}
                    onClick={() => props.onSelect(curie)}
                    style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                    <span
                        style={{
                            display: 'inline-block',
                            width: 160,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            fontWeight: curie === props.selectedCurie ? 'bold' : 'normal',
                        }}
                    >
                        {curie}
                    </span>
                    <span
                        style={{
                            display: 'inline-block',
                            width: 120,
                            backgroundColor: '#eee',
                        }}
                    >
                        <span
                            style={{
                                display: 'inline-block',
                                width: `${(value / max) * 120}px`,
                                backgroundColor:
                                    curie === props.selectedCurie ? '#2c7fb8' : '#999',
                                height: 10,
                            }}
                        />
                    </span>{' '}
                    <span>{value.toFixed(3)}</span>
                </div>
            ))}
        </div>
    );
}

export const AlphaGenomeTooltipContent: React.FunctionComponent<{
    annotation: AlphaGenomeAnnotation;
    cancerType?: string;
    ontologyCurie?: string;
    onTissueSelect?: (curie: string) => void;
}> = props => {
    const rows = props.annotation.annotation?.scores ?? [];
    const curies = availableCuries(rows);
    const [selectedType, setSelectedType] = React.useState<string>('RNA_SEQ');
    const [selectedCurie, setSelectedCurie] = React.useState<string | undefined>(
        props.ontologyCurie ?? defaultCurieForCancerType(props.cancerType) ?? curies[0]
    );
    const selectCurie = (curie: string) => {
        setSelectedCurie(curie);
        props.onTissueSelect?.(curie);
    };
    return (
        <div style={{ maxWidth: 460 }}>
            <div>
                <strong>
                    AlphaGenome {props.annotation.annotation?.canonical_gene ?? ''}
                </strong>{' '}
                ({props.annotation.annotation?.hg38_variant ?? ''})
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Output</th>
                        <th>Gene</th>
                        <th>Track</th>
                        <th>Raw</th>
                        <th>Quantile</th>
                    </tr>
                </thead>
                <tbody>
                    {OUTPUT_TYPES.map(outputType => {
                        const row = rowForOutputType(rows, outputType, selectedCurie);
                        if (!row) {
                            return null;
                        }
                        return (
                            <tr key={outputType}>
                                <td>
                                    <a
                                        href="#"
                                        onClick={e => {
                                            e.preventDefault();
                                            setSelectedType(outputType);
                                        }}
                                    >
                                        {outputType}
                                    </a>
                                </td>
                                <td>{row.gene_name ?? ''}</td>
                                <td>{row.track_name ?? ''}</td>
                                <td>{row.raw_score ?? ''}</td>
                                <td>{row.quantile_score ?? ''}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            {curies.length > 0 && (
                <div style={{ marginTop: 8 }}>
                    <label>
                        Tissue:{` `}
                        <select
                            value={selectedCurie ?? ''}
                            onChange={e => selectCurie(e.target.value)}
                        >
                            {curies.map(curie => (
                                <option key={curie} value={curie}>
                                    {curie}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            )}
            <TissueBarChart
                rows={rows}
                outputType={selectedType}
                selectedCurie={selectedCurie}
                onSelect={selectCurie}
            />
            <div style={{ marginTop: 8, fontStyle: 'italic' }}>{DISCLAIMER}</div>
        </div>
    );
};

export const AlphaGenomeCell: React.FunctionComponent<{
    annotation?: AlphaGenomeAnnotation;
    cancerType?: string;
    ontologyCurie?: string;
}> = props => {
    const rows = props.annotation?.annotation?.scores ?? [];
    const [selectedCurie, setSelectedCurie] = React.useState<string | undefined>(
        props.ontologyCurie ??
            defaultCurieForCancerType(props.cancerType) ??
            availableCuries(rows)[0]
    );
    const label = alphaGenomeLabel(props.annotation, selectedCurie);
    if (!label) {
        return <span className={`${annotationStyles['annotation-item']}`} />;
    }
    return (
        <DefaultTooltip
            placement="bottom"
            overlay={
                <AlphaGenomeTooltipContent
                    annotation={props.annotation!}
                    cancerType={props.cancerType}
                    ontologyCurie={selectedCurie}
                    onTissueSelect={setSelectedCurie}
                />
            }
        >
            <span
                className={`${annotationStyles['annotation-item']}`}
                style={{ display: 'inline-flex' }}
            >
                <span
                    title={`AlphaGenome: ${label}`}
                    style={{
                        fontSize: 11,
                        fontWeight: 'bold',
                        color: label === 'strong' ? '#d7301f' : '#fd8d3c',
                    }}
                >
                    αG
                </span>
            </span>
        </DefaultTooltip>
    );
};
