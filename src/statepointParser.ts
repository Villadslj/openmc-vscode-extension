import * as fs from 'fs';

export interface TallyFilter {
    id: number;
    type: string;
    bins?: number[];
    energyBins?: number[];
    cellBins?: number[];
    meshId?: number;
    numBins?: number;
}

export interface TallyResult {
    mean: number[];
    stdDev: number[];
    shape: number[];
}

export interface TallyData {
    id: string;
    name?: string;
    estimator?: string;
    scores: string[];
    filters: TallyFilter[];
    results?: TallyResult;
    numScoreBins?: number;
    nuclides?: string[];
}

export interface StatepointData {
    generalInfo?: Record<string, any>;
    tallies?: TallyData[];
    meshes?: Array<any>;
    summary?: Record<string, any>;
    filters?: Record<number, TallyFilter>;
}

export class StatepointParser {
    private h5wasm: any;
    private initialized: boolean = false;
    
    // Constants for formatting
    private readonly DECIMAL_PRECISION = 6;

    constructor() {}

    private async ensureInitialized(): Promise<void> {
        if (!this.initialized) {
            this.h5wasm = await import('h5wasm');
            await this.h5wasm.ready;
            this.initialized = true;
        }
    }

    async parseFile(filePath: string): Promise<StatepointData> {
        await this.ensureInitialized();

        try {
            // Read the file into a buffer
            const fileBuffer = fs.readFileSync(filePath);
            const uint8Array = new Uint8Array(fileBuffer);

            // Create a temporary file in the h5wasm virtual filesystem
            const tempFileName = '/temp_statepoint.h5';
            this.h5wasm.FS.writeFile(tempFileName, uint8Array);

            // Open the HDF5 file
            const h5file = new this.h5wasm.File(tempFileName, 'r');

            const data: StatepointData = {
                generalInfo: {},
                tallies: [],
                meshes: [],
                summary: {}
            };

            // Extract general information
            data.generalInfo = this.extractGeneralInfo(h5file);

            // Extract tallies
            // Extract filters first (used by tallies)
            data.filters = this.extractFilters(h5file);

            data.tallies = this.extractTallies(h5file, data.filters);

            // Extract meshes
            data.meshes = this.extractMeshes(h5file);

            // Extract summary statistics
            data.summary = this.extractSummary(h5file);

            h5file.close();

            // Clean up the temporary file
            try {
                this.h5wasm.FS.unlink(tempFileName);
            } catch (e) {
                // Ignore errors when cleaning up
            }

            return data;
        } catch (error) {
            // Clean up temporary file on error
            try {
                this.h5wasm.FS.unlink('/temp_statepoint.h5');
            } catch (e) {
                // Ignore errors when cleaning up
            }
            throw new Error(`Failed to parse statepoint file: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private extractGeneralInfo(h5file: any): Record<string, any> {
        const info: Record<string, any> = {};

        try {
            // Read root-level datasets that contain general info
            // In OpenMC statepoints, most info is stored as datasets, not attributes
            const datasetsToRead = [
                'n_particles',
                'n_batches',
                'current_batch',
                'n_realizations',
                'n_inactive',
                'generations_per_batch',
                'seed',
                'run_mode',
                'energy_mode'
            ];

            for (const dsName of datasetsToRead) {
                try {
                    const ds = h5file.get(dsName);
                    if (ds) {
                        let value = ds.value;
                        // Handle single-element arrays
                        if (Array.isArray(value) && value.length === 1) {
                            value = value[0];
                        }
                        // Convert typed arrays
                        if (value && value.buffer) {
                            value = Array.from(value);
                            if (value.length === 1) {
                                value = value[0];
                            }
                        }
                        info[dsName] = value;
                    }
                } catch (e) {
                    // Dataset doesn't exist, continue
                }
            }

            // Also read any root attributes
            try {
                const rootAttrs = h5file.attrs;
                for (const attrName of Object.keys(rootAttrs)) {
                    try {
                        if (info[attrName] === undefined) {
                            info[attrName] = rootAttrs[attrName];
                        }
                    } catch (e) {
                        // Skip attribute
                    }
                }
            } catch (e) {
                // No attributes
            }

            // If we didn't find anything, list available keys
            if (Object.keys(info).length === 0) {
                info['available_keys'] = h5file.keys().join(', ');
            }
        } catch (error) {
            info['error'] = `Could not read info: ${error instanceof Error ? error.message : String(error)}`;
        }

        return info;
    }

    private extractFilters(h5file: any): Record<number, TallyFilter> {
        const filters: Record<number, TallyFilter> = {};

        try {
            const talliesGroup = h5file.get('tallies');
            if (talliesGroup && talliesGroup.get('filters')) {
                const filtersGroup = talliesGroup.get('filters');
                const filterKeys = filtersGroup.keys().filter((k: string) => k.startsWith('filter '));

                for (const filterKey of filterKeys) {
                    try {
                        const filterGroup = filtersGroup.get(filterKey);
                        const filterId = parseInt(filterKey.replace('filter ', ''), 10);
                        
                        const filter: TallyFilter = {
                            id: filterId,
                            type: 'unknown'
                        };

                        // Read filter type
                        try {
                            const typeDs = filterGroup.get('type');
                            if (typeDs) {
                                let typeValue = typeDs.value;
                                if (Array.isArray(typeValue)) {
                                    typeValue = typeValue[0];
                                }
                                filter.type = String(typeValue).trim();
                            }
                        } catch (e) {
                            // Type not found
                        }

                        // Read number of bins
                        try {
                            const nBinsDs = filterGroup.get('n_bins');
                            if (nBinsDs) {
                                let nBins = nBinsDs.value;
                                if (Array.isArray(nBins)) {
                                    nBins = nBins[0];
                                }
                                if (nBins && nBins.buffer) {
                                    nBins = Array.from(nBins)[0];
                                }
                                filter.numBins = Number(nBins);
                            }
                        } catch (e) {
                            // n_bins not found
                        }

                        // Read bins/energy bins depending on filter type
                        try {
                            const binsDs = filterGroup.get('bins');
                            if (binsDs) {
                                let binsValue = binsDs.value;
                                if (binsValue && binsValue.buffer) {
                                    binsValue = Array.from(binsValue);
                                }
                                if (Array.isArray(binsValue)) {
                                    filter.bins = binsValue.map((v: any) => Number(v));
                                    // For energy filters, store as energyBins
                                    if (filter.type.toLowerCase().includes('energy')) {
                                        filter.energyBins = filter.bins;
                                    }
                                    // For cell filters, store as cellBins
                                    if (filter.type.toLowerCase().includes('cell')) {
                                        filter.cellBins = filter.bins;
                                    }
                                }
                            }
                        } catch (e) {
                            // bins not found
                        }

                        // Read mesh ID for mesh filters
                        try {
                            const meshDs = filterGroup.get('mesh');
                            if (meshDs) {
                                let meshId = meshDs.value;
                                if (Array.isArray(meshId)) {
                                    meshId = meshId[0];
                                }
                                if (meshId && meshId.buffer) {
                                    meshId = Array.from(meshId)[0];
                                }
                                filter.meshId = Number(meshId);
                            }
                        } catch (e) {
                            // mesh not found
                        }

                        filters[filterId] = filter;
                    } catch (e) {
                        console.error(`Error reading filter ${filterKey}:`, e);
                    }
                }
            }
        } catch (error) {
            console.error('Error extracting filters:', error);
        }

        return filters;
    }

    private extractTallies(h5file: any, filtersMap: Record<number, TallyFilter>): TallyData[] {
        const tallies: TallyData[] = [];

        try {
            // OpenMC statepoint files typically have tallies in /tallies group
            if (h5file.get('tallies')) {
                const talliesGroup = h5file.get('tallies');
                
                // keys() returns an array in h5wasm
                const tallyKeys = talliesGroup.keys().filter((k: string) => k.startsWith('tally '));
                
                for (const tallyKey of tallyKeys) {
                    try {
                        const tallyGroup = talliesGroup.get(tallyKey);
                        const tally: TallyData = {
                            id: tallyKey.replace('tally ', ''),
                            scores: [],
                            filters: []
                        };

                        // Read tally name
                        try {
                            const nameDs = tallyGroup.get('name');
                            if (nameDs) {
                                let nameValue = nameDs.value;
                                if (Array.isArray(nameValue)) {
                                    nameValue = nameValue[0];
                                }
                                tally.name = String(nameValue).trim();
                            }
                        } catch (e) {
                            // name not found
                        }

                        // Read estimator
                        try {
                            const estimatorDs = tallyGroup.get('estimator');
                            if (estimatorDs) {
                                let estimatorValue = estimatorDs.value;
                                if (Array.isArray(estimatorValue)) {
                                    estimatorValue = estimatorValue[0];
                                }
                                tally.estimator = String(estimatorValue).trim();
                            }
                        } catch (e) {
                            // estimator not found
                        }

                        // Read number of score bins
                        try {
                            const nScoreBinsDs = tallyGroup.get('n_score_bins');
                            if (nScoreBinsDs) {
                                let nScoreBins = nScoreBinsDs.value;
                                if (Array.isArray(nScoreBins)) {
                                    nScoreBins = nScoreBins[0];
                                }
                                if (nScoreBins && nScoreBins.buffer) {
                                    nScoreBins = Array.from(nScoreBins)[0];
                                }
                                tally.numScoreBins = Number(nScoreBins);
                            }
                        } catch (e) {
                            // n_score_bins not found
                        }

                        // Read scores
                        try {
                            const scoresDs = tallyGroup.get('score_bins');
                            if (scoresDs) {
                                let scoresValue = scoresDs.value;
                                if (scoresValue && scoresValue.buffer) {
                                    scoresValue = Array.from(scoresValue);
                                }
                                if (Array.isArray(scoresValue)) {
                                    tally.scores = scoresValue.map((v: any) => String(v).trim());
                                }
                            }
                        } catch (e) {
                            // scores not found
                        }

                        // Read nuclides
                        try {
                            const nuclidesDs = tallyGroup.get('nuclides');
                            if (nuclidesDs) {
                                let nuclidesValue = nuclidesDs.value;
                                if (nuclidesValue && nuclidesValue.buffer) {
                                    nuclidesValue = Array.from(nuclidesValue);
                                }
                                if (Array.isArray(nuclidesValue)) {
                                    tally.nuclides = nuclidesValue.map((v: any) => String(v).trim());
                                }
                            }
                        } catch (e) {
                            // nuclides not found
                        }

                        // Read filter IDs and associate filters
                        try {
                            const filtersDs = tallyGroup.get('filters');
                            if (filtersDs) {
                                let filterIds = filtersDs.value;
                                if (filterIds && filterIds.buffer) {
                                    filterIds = Array.from(filterIds);
                                }
                                if (Array.isArray(filterIds)) {
                                    for (const filterId of filterIds) {
                                        const id = Number(filterId);
                                        if (filtersMap[id]) {
                                            tally.filters.push(filtersMap[id]);
                                        }
                                    }
                                }
                            }
                        } catch (e) {
                            // filters not found
                        }

                        // Read results (mean and std_dev)
                        try {
                            const resultsDs = tallyGroup.get('results');
                            if (resultsDs) {
                                const resultsValue = resultsDs.value;
                                const shape = resultsDs.shape;
                                
                                if (resultsValue && resultsValue.length > 0) {
                                    // Results are typically stored as [n_bins, n_scores, 2]
                                    // where last dimension is [sum, sum_sq] or [mean, std_dev]
                                    const flatArray = resultsValue.buffer ? Array.from(resultsValue) : resultsValue;
                                    
                                    // Calculate mean and std_dev from the results
                                    // OpenMC stores results as: results[filter_bin, score_bin, 0] = sum
                                    //                          results[filter_bin, score_bin, 1] = sum_sq
                                    const totalBins = flatArray.length / 2;
                                    const mean: number[] = [];
                                    const stdDev: number[] = [];
                                    
                                    for (let i = 0; i < totalBins; i++) {
                                        const sumVal = flatArray[i * 2];
                                        const sumSqVal = flatArray[i * 2 + 1];
                                        mean.push(Number(sumVal));
                                        stdDev.push(Number(sumSqVal));
                                    }
                                    
                                    tally.results = {
                                        mean,
                                        stdDev,
                                        shape: Array.isArray(shape) ? shape : [shape]
                                    };
                                }
                            }
                        } catch (e) {
                            console.error(`Error reading results for ${tallyKey}:`, e);
                        }

                        tallies.push(tally);
                    } catch (e) {
                        // Skip this tally if there's an error
                        console.error(`Error reading tally ${tallyKey}:`, e);
                    }
                }
            }
        } catch (error) {
            console.error('Error extracting tallies:', error);
        }

        return tallies;
    }

    private extractMeshes(h5file: any): Array<any> {
        const meshes: Array<any> = [];

        try {
            // OpenMC statepoint files have meshes in /tallies/meshes group
            const talliesGroup = h5file.get('tallies');
            if (talliesGroup && talliesGroup.get('meshes')) {
                const meshesGroup = talliesGroup.get('meshes');
                
                // keys() returns an array in h5wasm
                const meshKeys = meshesGroup.keys().filter((k: string) => k.startsWith('mesh '));
                
                for (const meshKey of meshKeys) {
                    try {
                        const meshGroup = meshesGroup.get(meshKey);
                        const mesh: any = {
                            id: meshKey.replace('mesh ', '')
                        };

                        // Read mesh attributes
                        if (meshGroup.attrs) {
                            for (const attrName of Object.keys(meshGroup.attrs)) {
                                try {
                                    mesh[attrName] = meshGroup.attrs[attrName];
                                } catch (e) {
                                    // Skip attribute
                                }
                            }
                        }

                        // Try to read common mesh datasets
                        const datasetsToRead = ['dimension', 'lower_left', 'upper_right', 'width', 'type', 'n_dimension'];
                        for (const dsName of datasetsToRead) {
                            try {
                                const ds = meshGroup.get(dsName);
                                if (ds) {
                                    let value = ds.value;
                                    // Convert typed arrays to regular arrays
                                    if (value && value.buffer) {
                                        value = Array.from(value);
                                    }
                                    mesh[dsName] = value;
                                }
                            } catch (e) {
                                // Dataset doesn't exist, continue
                            }
                        }

                        meshes.push(mesh);
                    } catch (e) {
                        // Skip this mesh if there's an error
                        console.error(`Error reading mesh ${meshKey}:`, e);
                    }
                }
            }
        } catch (error) {
            console.error('Error extracting meshes:', error);
        }

        return meshes;
    }

    private extractSummary(h5file: any): Record<string, any> {
        const summary: Record<string, any> = {};

        try {
            // Try to read summary or global datasets
            const datasetsToRead = ['k_combined', 'entropy', 'global_tallies', 'runtime'];
            
            for (const dsName of datasetsToRead) {
                try {
                    if (h5file.get(dsName)) {
                        const dataset = h5file.get(dsName);
                        const value = dataset.value;
                        
                        // Format the value appropriately
                        if (Array.isArray(value)) {
                            if (value.length === 1) {
                                summary[dsName] = value[0];
                            } else if (value.length <= 10) {
                                summary[dsName] = value.join(', ');
                            } else {
                                summary[dsName] = `Array of ${value.length} values`;
                            }
                        } else {
                            summary[dsName] = value;
                        }
                    }
                } catch (e) {
                    // Dataset doesn't exist, continue
                }
            }

            // Try to read k_combined specifically (common in OpenMC)
            try {
                if (h5file.get('k_combined')) {
                    const kCombined = h5file.get('k_combined');
                    const kValue = kCombined.value;
                    if (Array.isArray(kValue) && kValue.length >= 2) {
                        summary['k_effective'] = `${kValue[0].toFixed(this.DECIMAL_PRECISION)} ± ${kValue[1].toFixed(this.DECIMAL_PRECISION)}`;
                    }
                }
            } catch (e) {
                // k_combined doesn't exist or can't be read
            }
        } catch (error) {
            console.error('Error extracting summary:', error);
        }

        return summary;
    }
}
