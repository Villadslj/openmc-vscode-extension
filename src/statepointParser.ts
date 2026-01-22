import * as fs from 'fs';

export interface StatepointData {
    generalInfo?: Record<string, any>;
    tallies?: Array<any>;
    meshes?: Array<any>;
    summary?: Record<string, any>;
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
            data.tallies = this.extractTallies(h5file);

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

    private extractTallies(h5file: any): Array<any> {
        const tallies: Array<any> = [];

        try {
            // OpenMC statepoint files typically have tallies in /tallies group
            if (h5file.get('tallies')) {
                const talliesGroup = h5file.get('tallies');
                
                // keys() returns an array in h5wasm
                const tallyKeys = talliesGroup.keys().filter((k: string) => k.startsWith('tally '));
                
                for (const tallyKey of tallyKeys) {
                    try {
                        const tallyGroup = talliesGroup.get(tallyKey);
                        const tally: any = {
                            id: tallyKey.replace('tally ', '')
                        };

                        // Read tally attributes
                        if (tallyGroup.attrs) {
                            for (const attrName of Object.keys(tallyGroup.attrs)) {
                                try {
                                    tally[attrName] = tallyGroup.attrs[attrName];
                                } catch (e) {
                                    // Skip attribute
                                }
                            }
                        }

                        // Read tally datasets (name, estimator, scores, etc.)
                        const datasetsToRead = ['name', 'estimator', 'n_realizations', 'n_score_bins', 'nuclides', 'score_bins', 'n_filters'];
                        for (const dsName of datasetsToRead) {
                            try {
                                const ds = tallyGroup.get(dsName);
                                if (ds) {
                                    let value = ds.value;
                                    // Convert typed arrays to regular arrays for better display
                                    if (value && value.buffer) {
                                        value = Array.from(value);
                                    }
                                    // Decode string arrays
                                    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
                                        tally[dsName] = value.join(', ');
                                    } else if (Array.isArray(value) && value.length === 1) {
                                        tally[dsName] = value[0];
                                    } else {
                                        tally[dsName] = value;
                                    }
                                }
                            } catch (e) {
                                // Dataset doesn't exist, continue
                            }
                        }

                        // Try to read results (mean and std_dev)
                        try {
                            const results = tallyGroup.get('results');
                            if (results) {
                                const resultsValue = results.value;
                                tally.results_shape = results.shape;
                                // Store summary of results
                                if (resultsValue && resultsValue.length) {
                                    tally.results_size = resultsValue.length;
                                }
                            }
                        } catch (e) {
                            // No results
                        }

                        // Try to read filter info
                        try {
                            const filtersDs = tallyGroup.get('filters');
                            if (filtersDs) {
                                const filterIds = filtersDs.value;
                                tally.filter_ids = Array.from(filterIds);
                            }
                        } catch (e) {
                            // No filters
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
