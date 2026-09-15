import * as fs from 'fs';
import * as path from 'path';

export interface DepletionMaterial {
    id: string;
    index: number;
    name?: string;
    volume?: number;
}

export interface DepletionTimeStep {
    index: number;
    time: number;          // seconds
    timeDays: number;      // days
    keff?: number;
    keffStdDev?: number;
    sourceRate?: number;
    depletionTime?: number;
}

export interface DepletionData {
    fileType?: string;
    version?: string;
    nSteps: number;
    materials: DepletionMaterial[];
    nuclides: string[];
    reactions: string[];
    timeSteps: DepletionTimeStep[];
    /**
     * Atom numbers indexed as [step][materialIndex][nuclideIndex].
     */
    numbers: number[][][];
    decayConstants: Record<string, number>;
    activityStatus?: string;
    warnings: string[];
}

const SECONDS_PER_DAY = 86400;

export class DepletionParser {
    private h5wasm: any;
    private initialized: boolean = false;

    private async ensureInitialized(): Promise<void> {
        if (!this.initialized) {
            this.h5wasm = await import('h5wasm');
            await this.h5wasm.ready;
            this.initialized = true;
        }
    }

    /**
     * Returns true when the given HDF5 file is an OpenMC depletion results file.
     */
    async isDepletionFile(filePath: string): Promise<boolean> {
        await this.ensureInitialized();
        const tempFileName = `/temp_depletion_probe_${Date.now()}.h5`;
        try {
            this.h5wasm.FS.writeFile(tempFileName, new Uint8Array(fs.readFileSync(filePath)));
            const h5file = new this.h5wasm.File(tempFileName, 'r');
            try {
                const fileType = this.readAttr(h5file, 'filetype');
                if (typeof fileType === 'string' && fileType.length > 0) {
                    // A self-declared file type is authoritative in both directions.
                    return fileType.includes('depletion');
                }
                const keys: string[] = h5file.keys();
                return keys.includes('number') && keys.includes('nuclides') && keys.includes('materials');
            } finally {
                h5file.close();
            }
        } catch (e) {
            return false;
        } finally {
            this.unlink(tempFileName);
        }
    }

    async parseFile(filePath: string): Promise<DepletionData> {
        await this.ensureInitialized();

        const tempFileName = `/temp_depletion_${Date.now()}.h5`;
        try {
            this.h5wasm.FS.writeFile(tempFileName, new Uint8Array(fs.readFileSync(filePath)));
            const h5file = new this.h5wasm.File(tempFileName, 'r');

            try {
                const warnings: string[] = [];

                const numberDs = this.getDataset(h5file, 'number');
                const numberShape: number[] = numberDs ? numberDs.shape : [];
                const expectedNuclides = numberShape.length > 0
                    ? numberShape[numberShape.length - 1]
                    : undefined;
                const materials = this.extractMaterials(h5file, warnings);
                const nuclides = this.extractIndexedGroup(
                    h5file, 'nuclides', 'atom number index', expectedNuclides, warnings);
                const reactions = this.extractIndexedGroup(h5file, 'reactions', 'index');
                const activityData = this.extractDecayConstants(nuclides.filter(Boolean));

                let numbers: number[][][] = [];
                let nSteps = 0;

                if (numberDs) {
                    const shape = numberShape;
                    const flat = this.toNumberArray(numberDs.value);
                    if (shape.length === 4) {
                        // Legacy format: (n_steps, n_stages, n_mats, n_nucs) - use first stage
                        numbers = this.reshapeLegacy(flat, shape);
                        warnings.push('Legacy depletion file format detected: only the first stage is shown.');
                    } else if (shape.length === 3) {
                        numbers = this.reshape3d(flat, shape);
                    } else {
                        warnings.push(`Unexpected shape for "number" dataset: [${shape.join(', ')}]`);
                    }
                    nSteps = numbers.length;
                } else {
                    warnings.push('No "number" dataset found; atom densities are unavailable.');
                }

                const timeSteps = this.extractTimeSteps(h5file, nSteps);
                if (timeSteps.length > nSteps) {
                    nSteps = timeSteps.length;
                }

                return {
                    fileType: this.readAttr(h5file, 'filetype'),
                    version: this.formatVersion(this.readAttr(h5file, 'version')),
                    nSteps,
                    materials,
                    nuclides,
                    reactions,
                    timeSteps,
                    numbers,
                    decayConstants: activityData.decayConstants,
                    activityStatus: activityData.status,
                    warnings
                };
            } finally {
                h5file.close();
            }
        } catch (error) {
            throw new Error(`Failed to parse depletion results file: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            this.unlink(tempFileName);
        }
    }

    private unlink(fileName: string): void {
        try {
            this.h5wasm.FS.unlink(fileName);
        } catch (e) {
            // Ignore clean-up errors
        }
    }

    private getDataset(h5file: any, name: string): any {
        try {
            const ds = h5file.get(name);
            return ds && ds.shape ? ds : undefined;
        } catch (e) {
            return undefined;
        }
    }

    private readAttr(node: any, name: string): any {
        try {
            const attrs = node.attrs;
            if (!attrs || attrs[name] === undefined) {
                return undefined;
            }
            let value = attrs[name];
            if (value && value.value !== undefined) {
                value = value.value;
            }
            if (value && value.buffer) {
                value = Array.from(value as ArrayLike<number>);
            }
            if (Array.isArray(value) && value.length === 1) {
                value = value[0];
            }
            return value;
        } catch (e) {
            return undefined;
        }
    }

    private toNumberArray(value: any): number[] {
        if (value === undefined || value === null) {
            return [];
        }
        if (Array.isArray(value)) {
            return value.map(Number);
        }
        if (value.buffer) {
            return Array.from(value as ArrayLike<number>, Number);
        }
        return [Number(value)];
    }

    private formatVersion(value: any): string | undefined {
        if (value === undefined) {
            return undefined;
        }
        return Array.isArray(value) ? value.join('.') : String(value);
    }

    private extractDecayConstants(nuclides: string[]): {
        decayConstants: Record<string, number>;
        status?: string;
    } {
        const configuredPath = process.env.OPENMC_CHAIN_FILE;
        if (!configuredPath) {
            return {
                decayConstants: {},
                status: 'Set the OPENMC_CHAIN_FILE environment variable to a depletion chain XML file to view activity.'
            };
        }

        const chainPath = path.resolve(configuredPath);
        let xml: string;
        try {
            xml = fs.readFileSync(chainPath, 'utf8');
        } catch (error) {
            return {
                decayConstants: {},
                status: `Could not read OPENMC_CHAIN_FILE "${configuredPath}": ${error instanceof Error ? error.message : String(error)}`
            };
        }

        const requested = new Set(nuclides);
        const decayConstants: Record<string, number> = {};
        const tagPattern = /<nuclide\b([^>]*)>/g;
        let match: RegExpExecArray | null;
        while ((match = tagPattern.exec(xml)) !== null) {
            const attributes = match[1];
            const nameMatch = /\bname\s*=\s*["']([^"']+)["']/.exec(attributes);
            if (!nameMatch || !requested.has(nameMatch[1])) {
                continue;
            }
            const halfLifeMatch = /\bhalf_life\s*=\s*["']([^"']+)["']/.exec(attributes);
            if (!halfLifeMatch) {
                // Nuclides without a half-life attribute are stable.
                decayConstants[nameMatch[1]] = 0;
                continue;
            }
            const halfLife = Number(halfLifeMatch[1]);
            if (isFinite(halfLife) && halfLife > 0) {
                decayConstants[nameMatch[1]] = Math.LN2 / halfLife;
            }
        }

        if (Object.keys(decayConstants).length === 0 && nuclides.length > 0) {
            return {
                decayConstants,
                status: `OPENMC_CHAIN_FILE "${configuredPath}" did not contain any nuclides from this depletion result.`
            };
        }

        return { decayConstants };
    }

    private extractMaterials(h5file: any, warnings: string[]): DepletionMaterial[] {
        const materials: DepletionMaterial[] = [];
        try {
            const group = h5file.get('materials');
            if (!group || typeof group.keys !== 'function') {
                warnings.push('No "materials" group found.');
                return materials;
            }
            for (const key of group.keys()) {
                try {
                    const matGroup = group.get(key);
                    materials.push({
                        id: key,
                        index: Number(this.readAttr(matGroup, 'index') ?? materials.length),
                        name: this.readAttr(matGroup, 'name'),
                        volume: this.asNumber(this.readAttr(matGroup, 'volume'))
                    });
                } catch (e) {
                    // Skip unreadable material
                }
            }
        } catch (e) {
            warnings.push('Could not read materials group.');
        }
        return materials.sort((a, b) => a.index - b.index);
    }

    private asNumber(value: any): number | undefined {
        if (value === undefined || value === null) {
            return undefined;
        }
        const n = Number(value);
        return isNaN(n) ? undefined : n;
    }

    /**
     * Reads a group whose members carry an integer index attribute and returns
     * the member names ordered by that index.
     */
    private extractIndexedGroup(
        h5file: any,
        groupName: string,
        indexAttr: string,
        expectedLength?: number,
        warnings?: string[]
    ): string[] {
        const entries: Array<{ name: string, index: number }> = [];
        try {
            const group = h5file.get(groupName);
            if (!group || typeof group.keys !== 'function') {
                return [];
            }
            for (const key of group.keys()) {
                try {
                    const index = this.asNumber(this.readAttr(group.get(key), indexAttr));
                    if (index !== undefined) {
                        entries.push({ name: key, index });
                    }
                } catch (e) {
                    // Skip unreadable entry
                }
            }
        } catch (e) {
            return [];
        }

        const ordered: string[] = [];
        for (const entry of entries.sort((a, b) => a.index - b.index)) {
            ordered[entry.index] = entry.name;
        }
        if (expectedLength !== undefined) {
            ordered.length = expectedLength;
            const missing: number[] = [];
            for (let i = 0; i < expectedLength; i++) {
                if (!ordered[i]) {
                    ordered[i] = `unknown nuclide ${i}`;
                    missing.push(i);
                }
            }
            if (missing.length > 0 && warnings) {
                warnings.push(
                    `The depletion "number" dataset has ${expectedLength} nuclide columns, but ` +
                    `${missing.length} column${missing.length === 1 ? '' : 's'} had no matching entry in ` +
                    `the "/${groupName}" index metadata. Placeholder names are shown so those inventories are not hidden.`
                );
            }
        }
        return ordered;
    }

    private reshape3d(flat: number[], shape: number[]): number[][][] {
        const [nSteps, nMats, nNucs] = shape;
        const result: number[][][] = [];
        for (let s = 0; s < nSteps; s++) {
            const step: number[][] = [];
            for (let m = 0; m < nMats; m++) {
                const start = (s * nMats + m) * nNucs;
                step.push(flat.slice(start, start + nNucs));
            }
            result.push(step);
        }
        return result;
    }

    private reshapeLegacy(flat: number[], shape: number[]): number[][][] {
        const [nSteps, nStages, nMats, nNucs] = shape;
        const result: number[][][] = [];
        for (let s = 0; s < nSteps; s++) {
            const step: number[][] = [];
            for (let m = 0; m < nMats; m++) {
                const start = ((s * nStages + 0) * nMats + m) * nNucs;
                step.push(flat.slice(start, start + nNucs));
            }
            result.push(step);
        }
        return result;
    }

    private extractTimeSteps(h5file: any, nStepsHint: number): DepletionTimeStep[] {
        const timeDs = this.getDataset(h5file, 'time');
        const eigDs = this.getDataset(h5file, 'eigenvalues');
        // Older files stored "power" instead of "source_rate"
        const rateDs = this.getDataset(h5file, 'source_rate') ?? this.getDataset(h5file, 'power');
        const procDs = this.getDataset(h5file, 'depletion time');

        const times = timeDs ? this.toNumberArray(timeDs.value) : [];
        const eigenvalues = eigDs ? this.toNumberArray(eigDs.value) : [];
        const rates = rateDs ? this.toNumberArray(rateDs.value) : [];
        const procTimes = procDs ? this.toNumberArray(procDs.value) : [];

        const timeCols = timeDs && timeDs.shape.length > 1 ? timeDs.shape[timeDs.shape.length - 1] : 1;
        const eigCols = eigDs ? eigDs.shape.slice(1).reduce((a: number, b: number) => a * b, 1) : 0;
        const rateCols = rateDs && rateDs.shape.length > 1
            ? rateDs.shape.slice(1).reduce((a: number, b: number) => a * b, 1)
            : 1;

        const nSteps = Math.max(
            timeDs ? timeDs.shape[0] : 0,
            eigDs ? eigDs.shape[0] : 0,
            nStepsHint
        );

        const steps: DepletionTimeStep[] = [];
        for (let i = 0; i < nSteps; i++) {
            const time = times.length > i * timeCols ? times[i * timeCols] : NaN;
            const step: DepletionTimeStep = {
                index: i,
                time,
                timeDays: isNaN(time) ? NaN : time / SECONDS_PER_DAY
            };

            if (eigCols > 0 && eigenvalues.length >= (i + 1) * eigCols) {
                // Last two entries of the row are (k, std dev), also for legacy
                // files that carry an extra stage dimension.
                const rowStart = i * eigCols;
                // Fixed-source and decay-only runs store NaN eigenvalues.
                if (isFinite(eigenvalues[rowStart])) {
                    step.keff = eigenvalues[rowStart];
                    step.keffStdDev = eigCols > 1 && isFinite(eigenvalues[rowStart + 1])
                        ? eigenvalues[rowStart + 1]
                        : undefined;
                }
            }
            if (rates.length > i * rateCols) {
                step.sourceRate = rates[i * rateCols];
            }
            if (procTimes.length > i) {
                step.depletionTime = procTimes[i];
            }
            steps.push(step);
        }
        return steps;
    }
}
