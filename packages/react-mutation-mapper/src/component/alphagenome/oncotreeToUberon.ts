/**
 * OncoTree cancer-type to UBERON tissue mapping for AlphaGenome tooltips.
 * Mirrors workstreams/contracts/oncotree_to_uberon.json (version 2026.10.1).
 */
export interface UberonTissueMapping {
    defaultCurie: string;
    defaultLabel: string;
    alternates: string[];
}

export const ONCOTREE_TO_UBERON: Record<string, UberonTissueMapping> = {
    PAAD: {
        defaultCurie: 'UBERON:0001264',
        defaultLabel: 'pancreas',
        alternates: ['UBERON:0001150'],
    },
    PANCREAS: {
        defaultCurie: 'UBERON:0001264',
        defaultLabel: 'pancreas',
        alternates: ['UBERON:0001150'],
    },
    PANET: {
        defaultCurie: 'UBERON:0000016',
        defaultLabel: 'endocrine pancreas',
        alternates: ['UBERON:0001264', 'CL:0000169'],
    },
    LUAD: {
        defaultCurie: 'UBERON:0002048',
        defaultLabel: 'lung',
        alternates: [],
    },
    LUSC: {
        defaultCurie: 'UBERON:0002048',
        defaultLabel: 'lung',
        alternates: [],
    },
    BRCA: {
        defaultCurie: 'UBERON:0000310',
        defaultLabel: 'breast',
        alternates: ['UBERON:0001911'],
    },
    COAD: {
        defaultCurie: 'UBERON:0001155',
        defaultLabel: 'colon',
        alternates: ['UBERON:0001157', 'UBERON:0001159'],
    },
    READ: {
        defaultCurie: 'UBERON:0001052',
        defaultLabel: 'rectum',
        alternates: ['UBERON:0001155'],
    },
    GBM: {
        defaultCurie: 'UBERON:0000955',
        defaultLabel: 'brain',
        alternates: ['UBERON:0001870'],
    },
    LGG: {
        defaultCurie: 'UBERON:0000955',
        defaultLabel: 'brain',
        alternates: ['UBERON:0001870'],
    },
    LIHC: {
        defaultCurie: 'UBERON:0002107',
        defaultLabel: 'liver',
        alternates: [],
    },
    PRAD: {
        defaultCurie: 'UBERON:0002367',
        defaultLabel: 'prostate gland',
        alternates: [],
    },
    KIRC: {
        defaultCurie: 'UBERON:0002113',
        defaultLabel: 'kidney',
        alternates: ['UBERON:0001225'],
    },
    SKCM: {
        defaultCurie: 'UBERON:0002097',
        defaultLabel: 'skin of body',
        alternates: [],
    },
    STAD: {
        defaultCurie: 'UBERON:0000945',
        defaultLabel: 'stomach',
        alternates: [],
    },
    OV: {
        defaultCurie: 'UBERON:0000992',
        defaultLabel: 'ovary',
        alternates: [],
    },
    BLCA: {
        defaultCurie: 'UBERON:0001255',
        defaultLabel: 'urinary bladder',
        alternates: [],
    },
    THCA: {
        defaultCurie: 'UBERON:0002046',
        defaultLabel: 'thyroid gland',
        alternates: [],
    },
};

export function defaultCurieForCancerType(
    cancerType: string | undefined
): string | undefined {
    if (!cancerType) {
        return undefined;
    }
    return ONCOTREE_TO_UBERON[cancerType.toUpperCase()]?.defaultCurie;
}
