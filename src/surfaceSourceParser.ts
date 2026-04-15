import * as fs from 'fs';

export interface EnergySpectrum {
    binEdges: number[];   // N+1 edges for N bins (eV)
    counts: number[];     // N bin counts
    totalParticles: number;
}

export interface SurfaceSourceData {
    isSurfaceSource: boolean;
    totalParticles: number;
    neutronSpectrum: EnergySpectrum;
    photonSpectrum: EnergySpectrum;
    otherParticleCount: number;
    surfaceIds: number[];
    fileVersion?: string;
    errorMessage?: string;
}

// OpenMC particle type codes
const PARTICLE_NEUTRON = 0;
const PARTICLE_PHOTON = 1;

// Energy histogram range and resolution
const ENERGY_MIN_EV = 1e-5;
const ENERGY_MAX_EV = 2e7;
const NUM_BINS = 100;

export class SurfaceSourceParser {
    private h5wasm: any;
    private initialized: boolean = false;

    constructor() {}

    private async ensureInitialized(): Promise<void> {
        if (!this.initialized) {
            this.h5wasm = await import('h5wasm');
            await this.h5wasm.ready;
            this.initialized = true;
        }
    }

    /**
     * Check if an already-open h5 file looks like an OpenMC surface source file.
     * Looks for a 'source_bank' dataset at the root level.
     */
    static isSurfaceSourceFile(h5file: any): boolean {
        try {
            const keys: string[] = h5file.keys();
            if (keys.includes('source_bank')) {
                return true;
            }
            // Also check root-level 'filetype' attribute
            try {
                const attrs = h5file.attrs;
                if (attrs && attrs.filetype !== undefined) {
                    const ft = String(attrs.filetype).toLowerCase();
                    if (ft.includes('source')) {
                        return true;
                    }
                }
            } catch (_) { /* no attrs */ }
        } catch (_) { /* ignore */ }
        return false;
    }

    async parseFile(filePath: string): Promise<SurfaceSourceData> {
        await this.ensureInitialized();

        const tempFileName = '/temp_surface_source.h5';
        let h5file: any = null;

        try {
            const fileBuffer = fs.readFileSync(filePath);
            const uint8Array = new Uint8Array(fileBuffer);

            this.h5wasm.FS.writeFile(tempFileName, uint8Array);
            h5file = new this.h5wasm.File(tempFileName, 'r');

            // Verify this is a surface source file
            if (!SurfaceSourceParser.isSurfaceSourceFile(h5file)) {
                throw new Error(
                    'File does not appear to be an OpenMC surface_source file ' +
                    '(no "source_bank" dataset found at root level).'
                );
            }

            // Read optional version attribute
            let fileVersion: string | undefined;
            try {
                const vAttr = h5file.attrs;
                if (vAttr && vAttr.version !== undefined) {
                    const v = vAttr.version;
                    fileVersion = Array.isArray(v) ? v.join('.') : String(v);
                }
            } catch (_) { /* ignore */ }

            // Parse source_bank
            const result = this.parseSourceBank(h5file);
            result.fileVersion = fileVersion;

            return result;
        } finally {
            if (h5file) {
                try { h5file.close(); } catch (_) { /* ignore */ }
            }
            try { this.h5wasm.FS.unlink(tempFileName); } catch (_) { /* ignore */ }
        }
    }

    private parseSourceBank(h5file: any): SurfaceSourceData {
        const sourceBankDs = h5file.get('source_bank');

        // Build log-spaced bin edges
        const binEdges = this.makeLogBins(ENERGY_MIN_EV, ENERGY_MAX_EV, NUM_BINS);
        const neutronCounts = new Array<number>(NUM_BINS).fill(0);
        const photonCounts  = new Array<number>(NUM_BINS).fill(0);

        let totalParticles = 0;
        let otherParticleCount = 0;
        let neutronTotal = 0;
        let photonTotal  = 0;
        const surfaceIdSet = new Set<number>();

        // h5wasm returns compound datasets as an object whose keys are the
        // field names and whose values are TypedArrays (one element per particle).
        // We attempt several access patterns for robustness.
        const value = sourceBankDs ? sourceBankDs.value : null;

        if (value === null || value === undefined) {
            return this.emptyResult(binEdges, 'source_bank dataset is empty or unreadable.');
        }

        // Pattern 1: compound fields as direct properties of value
        let energies: ArrayLike<number> | null = null;
        let particleTypes: ArrayLike<number> | null = null;
        let surfIds: ArrayLike<number> | null = null;

        if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Uint8Array)) {
            energies      = this.toNumberArray(value.E);
            particleTypes = this.toNumberArray(value.particle);
            surfIds       = this.toNumberArray(value.surf_id);
        }

        // Pattern 2: array of particle objects
        if (!energies && Array.isArray(value)) {
            const es: number[] = [];
            const ps: number[] = [];
            const ss: number[] = [];
            for (const p of value) {
                if (p && typeof p === 'object') {
                    es.push(p.E  !== undefined ? Number(p.E)        : NaN);
                    ps.push(p.particle !== undefined ? Number(p.particle) : -1);
                    ss.push(p.surf_id  !== undefined ? Number(p.surf_id)  : -1);
                }
            }
            if (es.length > 0) {
                energies      = es;
                particleTypes = ps;
                surfIds       = ss;
            }
        }

        if (!energies) {
            return this.emptyResult(
                binEdges,
                'Could not read particle data from source_bank. ' +
                'The compound dataset format may not be supported.'
            );
        }

        totalParticles = energies.length;

        for (let i = 0; i < totalParticles; i++) {
            const E  = Number(energies[i]);
            const pt = particleTypes ? Number(particleTypes[i]) : -1;
            const sid = surfIds ? Number(surfIds[i]) : -1;

            if (sid >= 0 && isFinite(sid)) {
                surfaceIdSet.add(sid);
            }

            if (!isFinite(E) || E <= 0) { continue; }

            const binIdx = this.findBin(E, binEdges);
            if (binIdx < 0) { continue; }

            if (pt === PARTICLE_NEUTRON) {
                neutronCounts[binIdx]++;
                neutronTotal++;
            } else if (pt === PARTICLE_PHOTON) {
                photonCounts[binIdx]++;
                photonTotal++;
            } else {
                otherParticleCount++;
            }
        }

        return {
            isSurfaceSource: true,
            totalParticles,
            neutronSpectrum: { binEdges, counts: neutronCounts, totalParticles: neutronTotal },
            photonSpectrum:  { binEdges, counts: photonCounts,  totalParticles: photonTotal  },
            otherParticleCount,
            surfaceIds: Array.from(surfaceIdSet).sort((a, b) => a - b),
        };
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private makeLogBins(eMin: number, eMax: number, nBins: number): number[] {
        const logMin = Math.log10(eMin);
        const logMax = Math.log10(eMax);
        const edges: number[] = [];
        for (let i = 0; i <= nBins; i++) {
            edges.push(Math.pow(10, logMin + (logMax - logMin) * i / nBins));
        }
        return edges;
    }

    /** Returns the bin index [0, nBins-1] for value E, or -1 if out of range. */
    private findBin(E: number, edges: number[]): number {
        if (E < edges[0] || E >= edges[edges.length - 1]) { return -1; }
        // Binary search
        let lo = 0;
        let hi = edges.length - 2;
        while (lo < hi) {
            const mid = Math.floor((lo + hi + 1) / 2);
            if (edges[mid] <= E) { lo = mid; } else { hi = mid - 1; }
        }
        return lo;
    }

    private toNumberArray(arr: any): number[] | null {
        if (arr === undefined || arr === null) { return null; }
        if (arr.buffer) { return Array.from(arr as any) as number[]; }
        if (Array.isArray(arr)) { return arr.map(Number); }
        return null;
    }

    private emptyResult(binEdges: number[], errorMessage: string): SurfaceSourceData {
        const emptyCounts = new Array<number>(NUM_BINS).fill(0);
        return {
            isSurfaceSource: true,
            totalParticles: 0,
            neutronSpectrum: { binEdges, counts: emptyCounts, totalParticles: 0 },
            photonSpectrum:  { binEdges, counts: [...emptyCounts], totalParticles: 0 },
            otherParticleCount: 0,
            surfaceIds: [],
            errorMessage,
        };
    }
}
