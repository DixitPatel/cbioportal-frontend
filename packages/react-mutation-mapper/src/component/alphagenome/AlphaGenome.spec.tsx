import { assert } from 'chai';
import { fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';
import {
    AlphaGenomeCell,
    alphaGenomeLabel,
    scoreLevel,
    sortValue,
    DISCLAIMER,
} from './AlphaGenome';
import { AlphaGenomeAnnotation } from 'genome-nexus-ts-api-client';

function annotationWithScores(scores: any[]): AlphaGenomeAnnotation {
    return {
        license: 'test',
        annotation: {
            variant: '7:g.140453136A>T',
            hg38_variant: 'chr7:140753336:A>T',
            scored_interval: 'chr7:140229048-141277624',
            model_version: 'alphagenome-v1',
            canonical_gene_id: 'ENSG00000157764',
            canonical_gene: 'BRAF',
            merged_splicing_score: 0.15,
            scores,
        },
    } as AlphaGenomeAnnotation;
}

function row(
    outputType: string,
    rawScore: number | undefined,
    quantileScore: number | undefined,
    ontologyCurie?: string
) {
    return {
        output_type: outputType,
        variant_scorer: 'GeneMaskSplicingScorer',
        gene_id: 'ENSG00000157764',
        gene_name: 'BRAF',
        track_name: 'donor_plus',
        ontology_curie: ontologyCurie,
        biosample_name: 'pancreas',
        raw_score: rawScore,
        quantile_score: quantileScore,
    };
}

describe('AlphaGenome dual-gate labels', () => {
    it('returns undefined when quantile gate fails', () => {
        assert.isUndefined(scoreLevel('RNA_SEQ', 0.9, 0.5));
    });

    it('grades RNA_SEQ by |LFC|', () => {
        assert.equal(scoreLevel('RNA_SEQ', 0.612, 0.994), 'strong');
        assert.equal(scoreLevel('RNA_SEQ', -0.612, -0.994), 'strong');
        assert.equal(scoreLevel('RNA_SEQ', 0.2, 0.995), 'moderate');
        assert.isUndefined(scoreLevel('RNA_SEQ', 0.05, 0.999));
    });

    it('grades splicing deltas without abs', () => {
        assert.equal(scoreLevel('SPLICE_SITES', 0.5, 0.99), 'strong');
        assert.equal(scoreLevel('SPLICE_SITE_USAGE', 0.2, 0.999), 'moderate');
        assert.isUndefined(scoreLevel('SPLICE_JUNCTIONS', 0.1, 0.999));
    });

    it('prefers tissue rows but accepts tissue-independent SPLICE_SITES', () => {
        const annotation = annotationWithScores([
            row('RNA_SEQ', 0.9, 0.999, 'UBERON:0001264'),
            row('SPLICE_SITES', 0.6, 0.999, 'UBERON:0002048'),
        ]);
        assert.equal(
            alphaGenomeLabel(annotation, 'UBERON:0000955'),
            'strong'
        );
        assert.equal(alphaGenomeLabel(annotation, undefined), 'strong');
    });

    it('returns undefined without a passing row', () => {
        const annotation = annotationWithScores([
            row('RNA_SEQ', 0.9, 0.5, 'UBERON:0001264'),
        ]);
        assert.isUndefined(alphaGenomeLabel(annotation, 'UBERON:0001264'));
        assert.isUndefined(alphaGenomeLabel(undefined, 'UBERON:0001264'));
    });

    it('sorts strong before moderate before none', () => {
        const strong = annotationWithScores([
            row('SPLICE_SITES', 0.6, 0.999),
        ]);
        const moderate = annotationWithScores([
            row('SPLICE_SITES', 0.3, 0.999),
        ]);
        assert.isBelow(sortValue(strong), sortValue(moderate));
        assert.isBelow(sortValue(moderate), sortValue(undefined));
    });

    it('always carries the non-clinical disclaimer', () => {
        assert.include(DISCLAIMER, 'not experimental evidence');
    });
});

describe('AlphaGenomeCell across table sorts', () => {
    it('keeps the icon when a new annotation arrives under a stored tissue selection', () => {
        // react-table v6 reuses the cell instance by position on sort, so the
        // mounted tissue selection can belong to the previous row's mutation.
        // The cell must fall back to the new annotation's tissues, not blank.
        const before = annotationWithScores([
            row('RNA_SEQ', 0.9, 0.995, 'CL:0000001'),
        ]);
        const after = annotationWithScores([
            row('RNA_SEQ', 0.9, 0.995, 'CL:0000002'),
        ]);
        const { rerender, container } = render(
            <AlphaGenomeCell annotation={before} />
        );
        assert.include(container.textContent ?? '', 'αG');
        rerender(<AlphaGenomeCell annotation={after} />);
        assert.include(container.textContent ?? '', 'αG');
    });

    it('shows a spinner in the pinned slot while scoring with no label', () => {
        const annotation = annotationWithScores([
            row('RNA_SEQ', 0.9, 0.5, 'CL:0000001'),
        ]);
        const { container } = render(
            <AlphaGenomeCell annotation={annotation} status="pending" />
        );
        assert.notInclude(container.textContent ?? '', 'αG');
        assert.isNotNull(
            container.querySelector('.fa-spinner'),
            'expected a loading spinner while pending'
        );
    });

    it('renders an empty pinned placeholder when idle with no label', () => {
        const annotation = annotationWithScores([
            row('RNA_SEQ', 0.9, 0.5, 'CL:0000001'),
        ]);
        const { container } = render(
            <AlphaGenomeCell annotation={annotation} status="complete" />
        );
        assert.notInclude(container.textContent ?? '', 'αG');
        assert.isNull(container.querySelector('.fa-spinner'));
        assert.isNotNull(
            container.querySelector('.annotation-item'),
            'expected the pinned 22px placeholder slot'
        );
    });

    it('keeps the table icon after exploring a tissue with no passing score', async () => {
        // The tooltip tissue selector must not write back into the cell:
        // picking a failing tissue blanked the icon, removing the only way
        // to reopen the tooltip.
        const annotation = annotationWithScores([
            row('RNA_SEQ', 0.9, 0.995, 'CL:0000001'),
            row('RNA_SEQ', 0.01, 0.5, 'CL:0000002'),
        ]);
        const { container } = render(
            <AlphaGenomeCell annotation={annotation} />
        );
        assert.include(container.textContent ?? '', 'αG');
        fireEvent.mouseEnter(container.firstChild as Element);
        const select = await waitFor(() => {
            const el = document.body.querySelector('select');
            assert.isNotNull(el);
            return el as HTMLSelectElement;
        });
        fireEvent.change(select, { target: { value: 'CL:0000002' } });
        assert.include(container.textContent ?? '', 'αG');
        assert.include(document.body.textContent ?? '', 'CL:0000002');
    });
});
