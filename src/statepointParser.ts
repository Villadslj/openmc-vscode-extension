import * as fs from 'fs';

export interface StatepointData {
    generalInfo?: Record<string, any>;
    tallies?: Array<any>;
    meshes?: Array<any>;
    summary?: Record<string, any>;
}

export class StatepointParser {
    private h5Module: any;
    private initialized: boolean = false;
    
    // Constants for formatting
    private readonly DECIMAL_PRECISION = 6;

    constructor() {}

    private async ensureInitialized(): Promise<void> {
        if (!this.initialized) {
            const h5wasm = await import('h5wasm');
            this.h5Module = await h5wasm.ready;
            this.initialized = true;
        }
    }

    async parseFile(filePath: string): Promise<StatepointData> {
        await this.ensureInitialized();

        try {
            // Read the file into a buffer
            const fileBuffer = fs.readFileSync(filePath);
            const uint8Array = new Uint8Array(fileBuffer);

            // Open the HDF5 file
            const h5file = new this.h5Module.File(uint8Array, 'r');

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

            return data;
        } catch (error) {
            throw new Error(`Failed to parse statepoint file: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private extractGeneralInfo(h5file: any): Record<string, any> {
        const info: Record<string, any> = {};

        try {
            // Try to read common OpenMC statepoint attributes
            const rootAttrs = h5file.attrs;
            
            // Common attributes in OpenMC statepoint files
            const attributesToRead = [
                'version',
                'filetype',
                'n_particles',
                'n_batches',
                'current_batch',
                'n_realizations',
                'n_inactive',
                'gen_per_batch',
                'date_and_time',
                'seed'
            ];

            for (const attrName of attributesToRead) {
                try {
                    if (rootAttrs[attrName] !== undefined) {
                        info[attrName] = rootAttrs[attrName];
                    }
                } catch (e) {
                    // Attribute doesn't exist, continue
                }
            }

            // If we didn't find standard attributes, list what we have
            if (Object.keys(info).length === 0) {
                info['available_attributes'] = Object.keys(rootAttrs).join(', ');
            }
        } catch (error) {
            info['error'] = `Could not read attributes: ${error instanceof Error ? error.message : String(error)}`;
        }

        return info;
    }

    private extractTallies(h5file: any): Array<any> {
        const tallies: Array<any> = [];

        try {
            // OpenMC statepoint files typically have tallies in /tallies group
            if (h5file.get('tallies')) {
                const talliesGroup = h5file.get('tallies');
                
                // Iterate through tally IDs
                for (const tallyKey of Object.keys(talliesGroup.keys)) {
                    try {
                        const tallyGroup = talliesGroup.get(tallyKey);
                        const tally: any = {
                            id: tallyKey
                        };

                        // Read tally attributes and datasets
                        if (tallyGroup.attrs) {
                            Object.assign(tally, tallyGroup.attrs);
                        }

                        // Try to read common tally datasets
                        const datasetsToRead = ['results', 'mean', 'sum', 'sum_sq', 'n_realizations'];
                        for (const dsName of datasetsToRead) {
                            try {
                                if (tallyGroup.get(dsName)) {
                                    const dataset = tallyGroup.get(dsName);
                                    tally[dsName] = dataset.value;
                                }
                            } catch (e) {
                                // Dataset doesn't exist, continue
                            }
                        }

                        // Try to read filters
                        if (tallyGroup.get('filters')) {
                            const filtersGroup = tallyGroup.get('filters');
                            tally.filters = Object.keys(filtersGroup.keys);
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
            // OpenMC statepoint files may have meshes in /meshes group
            if (h5file.get('meshes')) {
                const meshesGroup = h5file.get('meshes');
                
                // Iterate through mesh IDs
                for (const meshKey of Object.keys(meshesGroup.keys)) {
                    try {
                        const meshGroup = meshesGroup.get(meshKey);
                        const mesh: any = {
                            id: meshKey
                        };

                        // Read mesh attributes
                        if (meshGroup.attrs) {
                            Object.assign(mesh, meshGroup.attrs);
                        }

                        // Try to read common mesh datasets
                        const datasetsToRead = ['dimension', 'lower_left', 'upper_right', 'width', 'type'];
                        for (const dsName of datasetsToRead) {
                            try {
                                if (meshGroup.get(dsName)) {
                                    const dataset = meshGroup.get(dsName);
                                    mesh[dsName] = dataset.value;
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
