import * as vscode from 'vscode';
import * as path from 'path';
import { DepletionParser, DepletionData } from './depletionParser';

export class DepletionEditorProvider implements vscode.CustomReadonlyEditorProvider {
    constructor(private readonly context: vscode.ExtensionContext) {}

    async openCustomDocument(
        uri: vscode.Uri,
        openContext: vscode.CustomDocumentOpenContext,
        token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        return { uri, dispose: () => {} };
    }

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(this.context.extensionPath, 'node_modules'))
            ]
        };

        try {
            const parser = new DepletionParser();
            if (!(await parser.isDepletionFile(document.uri.fsPath))) {
                webviewPanel.webview.html = this.getErrorContent(
                    `"${path.basename(document.uri.fsPath)}" is not an OpenMC depletion results file. ` +
                    `If it is a statepoint file, open it with the "OpenMC Statepoint Viewer" instead.`
                );
                return;
            }
            const data = await parser.parseFile(document.uri.fsPath);
            webviewPanel.webview.html = this.getWebviewContent(data, document.uri, webviewPanel.webview);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            webviewPanel.webview.html = this.getErrorContent(errorMessage);
        }
    }

    getWebviewContent(data: DepletionData, uri: vscode.Uri, webview: vscode.Webview): string {
        const fileName = path.basename(uri.fsPath);
        const chartJsUri = webview.asWebviewUri(vscode.Uri.file(
            path.join(this.context.extensionPath, 'node_modules', 'chart.js', 'dist', 'chart.umd.js')
        ));

        // Only the data needed by the webview scripts is serialized.
        const payload = JSON.stringify({
            materials: data.materials,
            nuclides: data.nuclides,
            timeSteps: data.timeSteps,
            numbers: data.numbers
        });

        const stepRows = data.timeSteps.map(step => `
            <tr>
                <td>${step.index}</td>
                <td>${this.formatNumber(step.time)}</td>
                <td>${this.formatNumber(step.timeDays)}</td>
                <td>${step.keff !== undefined && isFinite(step.keff) ? this.formatFixed(step.keff) + (step.keffStdDev ? ' ± ' + this.formatFixed(step.keffStdDev) : '') : '-'}</td>
                <td>${step.sourceRate !== undefined ? this.formatNumber(step.sourceRate) : '-'}</td>
                <td>${step.depletionTime !== undefined ? this.formatNumber(step.depletionTime) : '-'}</td>
            </tr>`).join('');

        const materialOptions = data.materials.map(m =>
            `<option value="${m.index}">${this.escapeHtml(m.name ? `${m.id} (${m.name})` : `Material ${m.id}`)}</option>`
        ).join('');

        const stepOptions = data.timeSteps.map(s =>
            `<option value="${s.index}">Step ${s.index} — ${this.formatNumber(s.timeDays)} d</option>`
        ).join('');

        const totalTime = data.timeSteps.length > 0
            ? this.formatNumber(data.timeSteps[data.timeSteps.length - 1].timeDays)
            : 'n/a';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource} 'unsafe-inline'; style-src ${webview.cspSource} 'unsafe-inline';">
    <title>OpenMC Depletion Results</title>
    <script src="${chartJsUri}"></script>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            line-height: 1.6;
        }
        h1, h2 {
            color: var(--vscode-editor-foreground);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 8px;
        }
        .section {
            margin-bottom: 30px;
            padding: 15px;
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 5px;
        }
        .info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 15px;
        }
        .info-item {
            padding: 10px;
            background-color: var(--vscode-editor-background);
            border-radius: 3px;
        }
        .info-label {
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
        }
        th, td {
            padding: 6px 10px;
            text-align: left;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        th {
            background-color: var(--vscode-editor-background);
        }
        select, input {
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-panel-border);
            padding: 4px 6px;
        }
        input[type="checkbox"] {
            padding: 0;
            vertical-align: middle;
        }
        input[type="search"] {
            min-width: 220px;
        }
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 5px 10px;
            border-radius: 2px;
            cursor: pointer;
        }
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .controls {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px 12px;
            margin-bottom: 10px;
        }
        .controls label {
            white-space: nowrap;
        }
        .hint {
            color: var(--vscode-descriptionForeground);
            font-size: 0.9em;
        }
        .nuclide-list {
            max-height: 210px;
            overflow-y: auto;
            padding: 8px;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 3px;
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 2px 12px;
        }
        .nuclide-list label {
            display: flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
        }
        .chips {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin: 10px 0;
        }
        .chip {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 1px 6px 1px 10px;
            border-radius: 12px;
            font-size: 0.9em;
            border-left: 6px solid transparent;
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }
        .chip button {
            background: none;
            border: none;
            color: inherit;
            cursor: pointer;
            padding: 0 2px;
            font-size: 1.1em;
            line-height: 1;
        }
        .chip button:hover {
            background: none;
            opacity: 0.7;
        }
        .chart-container {
            background-color: var(--vscode-editor-background);
            padding: 10px;
            border-radius: 4px;
            margin-top: 10px;
        }
        .warning {
            color: var(--vscode-editorWarning-foreground, #cca700);
        }
        .empty-message {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
        .scroll-table {
            max-height: 420px;
            overflow-y: auto;
        }
    </style>
</head>
<body>
    <h1>OpenMC Depletion Results: ${this.escapeHtml(fileName)}</h1>

    <div class="section">
        <h2>Overview</h2>
        <div class="info-grid">
            <div class="info-item"><div class="info-label">File Path</div><div>${this.escapeHtml(uri.fsPath)}</div></div>
            <div class="info-item"><div class="info-label">File Type</div><div>${this.escapeHtml(String(data.fileType ?? 'depletion results'))}</div></div>
            <div class="info-item"><div class="info-label">Format Version</div><div>${this.escapeHtml(String(data.version ?? 'unknown'))}</div></div>
            <div class="info-item"><div class="info-label">Time Steps</div><div>${data.nSteps}</div></div>
            <div class="info-item"><div class="info-label">Total Depletion Time</div><div>${totalTime} days</div></div>
            <div class="info-item"><div class="info-label">Materials</div><div>${data.materials.length}</div></div>
            <div class="info-item"><div class="info-label">Nuclides</div><div>${data.nuclides.length}</div></div>
            <div class="info-item"><div class="info-label">Reactions Tracked</div><div>${data.reactions.length > 0 ? this.escapeHtml(data.reactions.join(', ')) : 'none'}</div></div>
        </div>
        ${data.warnings.length > 0 ? `<p class="warning">${data.warnings.map(w => this.escapeHtml(w)).join('<br>')}</p>` : ''}
    </div>

    <div class="section">
        <h2>Time Steps</h2>
        ${data.timeSteps.length > 0 ? `
        <div class="scroll-table">
        <table>
            <thead><tr><th>Step</th><th>Time (s)</th><th>Time (days)</th><th>k-effective</th><th>Source rate</th><th>Depletion time (s)</th></tr></thead>
            <tbody>${stepRows}</tbody>
        </table>
        </div>
        <div class="chart-container"><canvas id="keffChart" height="110"></canvas></div>
        ` : '<div class="empty-message">No time step data found</div>'}
    </div>

    <div class="section">
        <h2>Material Composition</h2>
        ${data.materials.length > 0 && data.numbers.length > 0 ? `
        <div class="controls">
            <label>Material</label>
            <select id="matSelect">${materialOptions}</select>
            <label>Step</label>
            <select id="stepSelect">${stepOptions}</select>
            <label>Search</label>
            <input id="compSearch" type="search" placeholder="e.g. Pu, 137, Cs137, U235 Pu239">
            <label>Max rows</label>
            <input id="topN" type="number" min="1" max="5000" value="25" style="width: 70px;">
            <label><input type="checkbox" id="compHideZero" checked> Hide zero</label>
            <button id="compClear" type="button">Clear</button>
            <span class="hint" id="compCount"></span>
        </div>
        <div class="hint">Search by element (<code>Pu</code>), mass number (<code>137</code>) or full name (<code>Cs137</code>). Separate several terms with spaces or commas to match any of them.</div>
        <div class="scroll-table">
            <table>
                <thead><tr><th>Nuclide</th><th>Atoms</th><th>Atom density (atom/b-cm)</th><th>Fraction</th></tr></thead>
                <tbody id="compBody"></tbody>
            </table>
        </div>
        ` : '<div class="empty-message">No composition data found</div>'}
    </div>

    <div class="section">
        <h2>Nuclide Evolution</h2>
        ${data.materials.length > 0 && data.numbers.length > 0 ? `
        <div class="controls">
            <label>Material</label>
            <select id="evoMatSelect">${materialOptions}</select>
            <label>Search</label>
            <input id="evoSearch" type="search" placeholder="e.g. Pu, 137, Cs137, U235 Pu239">
            <button id="evoAddMatching" type="button">Add matching</button>
            <button id="evoClear" type="button">Clear selection</button>
            <label><input type="checkbox" id="evoLogScale"> Log scale</label>
            <span class="hint" id="evoCount"></span>
        </div>
        <div class="hint">Tick several nuclides to overlay them. Sorted by abundance in the final step.</div>
        <div class="chips" id="evoChips"></div>
        <div class="nuclide-list" id="evoNucList"></div>
        <div class="chart-container"><canvas id="evoChart" height="110"></canvas></div>
        ` : '<div class="empty-message">No composition data found</div>'}
    </div>

    <script>
        const depletion = ${payload};
        const BARN_CM = 1e-24;
        const MAX_LIST_ENTRIES = 400;
        const MAX_BULK_ADD = 20;
        const PALETTE = ['#3794ff', '#4e9a06', '#e5c07b', '#e06c75', '#c678dd', '#56b6c2',
                         '#d19a66', '#98c379', '#61afef', '#be5046', '#f0a30a', '#9d7cd8'];

        // OpenMC names nuclides as <element><mass>[_m<state>], e.g. U235, Am242_m1.
        const NUCLIDE_RE = /^([A-Za-z]+)(\\d+)(?:_m(\\d+))?$/;
        const nuclideInfo = [];
        for (let i = 0; i < depletion.nuclides.length; i++) {
            const name = depletion.nuclides[i] || '';
            const match = NUCLIDE_RE.exec(name);
            nuclideInfo[i] = {
                name: name,
                norm: name.toLowerCase().replace(/[-_\\s]/g, ''),
                element: (match ? match[1] : name).toLowerCase(),
                mass: match ? parseInt(match[2], 10) : NaN,
                meta: match && match[3] ? parseInt(match[3], 10) : 0
            };
        }
        const nuclideIndexByName = {};
        nuclideInfo.forEach(function (info, i) {
            if (info.name) { nuclideIndexByName[info.name] = i; }
        });

        function fmt(value) {
            if (value === undefined || value === null || isNaN(value)) { return '-'; }
            if (value === 0) { return '0'; }
            return Math.abs(value) >= 1e-3 && Math.abs(value) < 1e6
                ? value.toPrecision(6)
                : value.toExponential(4);
        }

        function escapeHtml(text) {
            return String(text)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        function materialByIndex(index) {
            return depletion.materials.find(m => m.index === index);
        }

        function parseQuery(raw) {
            return String(raw || '')
                .toLowerCase()
                .split(/[,;\\s]+/)
                .map(t => t.replace(/[-_]/g, ''))
                .filter(Boolean);
        }

        // Terms are OR-ed: a bare number matches the mass number, bare letters
        // match the element symbol by prefix, and "<element><mass>[m<state>]"
        // matches that exact nuclide. Anything else falls back to a substring.
        function matchesTerms(info, terms) {
            if (terms.length === 0) { return true; }
            return terms.some(function (term) {
                if (/^\\d+$/.test(term)) { return info.mass === parseInt(term, 10); }
                if (/^[a-z]+$/.test(term)) { return info.element.indexOf(term) === 0; }
                const parts = /^([a-z]+)(\\d+)(?:m(\\d+))?$/.exec(term);
                if (parts) {
                    if (info.element !== parts[1] || info.mass !== parseInt(parts[2], 10)) { return false; }
                    // Without an explicit state, ground and metastable both match.
                    return parts[3] === undefined || info.meta === parseInt(parts[3], 10);
                }
                return info.norm.indexOf(term) >= 0;
            });
        }

        function atomsForSelection(matIndex, stepIndex) {
            const step = depletion.numbers[stepIndex];
            return (step && step[matIndex]) || null;
        }

        function renderComposition() {
            const body = document.getElementById('compBody');
            if (!body) { return; }
            const matIndex = parseInt(document.getElementById('matSelect').value, 10);
            const stepIndex = parseInt(document.getElementById('stepSelect').value, 10);
            const topN = Math.max(1, parseInt(document.getElementById('topN').value, 10) || 25);
            const terms = parseQuery(document.getElementById('compSearch').value);
            const hideZero = document.getElementById('compHideZero').checked;
            const count = document.getElementById('compCount');
            const values = atomsForSelection(matIndex, stepIndex);
            if (!values) {
                body.innerHTML = '<tr><td colspan="4">No data for this selection</td></tr>';
                count.textContent = '';
                return;
            }
            const total = values.reduce((a, b) => a + (b || 0), 0);
            const material = materialByIndex(matIndex);
            const volume = material && material.volume ? material.volume : null;

            const matched = [];
            for (let i = 0; i < nuclideInfo.length; i++) {
                const info = nuclideInfo[i];
                if (!info || !info.name) { continue; }
                const atoms = values[i] || 0;
                if (hideZero && !(atoms > 0)) { continue; }
                if (!matchesTerms(info, terms)) { continue; }
                matched.push({ nuclide: info.name, atoms: atoms });
            }
            matched.sort((a, b) => b.atoms - a.atoms);
            const rows = matched.slice(0, topN);

            count.textContent = matched.length === 0
                ? 'no nuclides match'
                : 'showing ' + rows.length + ' of ' + matched.length + ' matching nuclides';

            body.innerHTML = rows.length === 0
                ? '<tr><td colspan="4">' + (terms.length > 0 ? 'No nuclide matches this search' : 'All nuclide densities are zero') + '</td></tr>'
                : rows.map(r => '<tr><td>' + escapeHtml(r.nuclide) + '</td><td>' + fmt(r.atoms) + '</td><td>' +
                    (volume ? fmt(r.atoms / volume * BARN_CM) : '-') + '</td><td>' +
                    (total > 0 ? (100 * r.atoms / total).toFixed(4) + ' %' : '-') + '</td></tr>').join('');
        }

        const evoSelected = [];

        function evoColor(name) {
            return PALETTE[evoSelected.indexOf(name) % PALETTE.length];
        }

        function evoMatchingNuclides() {
            const terms = parseQuery(document.getElementById('evoSearch').value);
            const matIndex = parseInt(document.getElementById('evoMatSelect').value, 10);
            const lastStep = depletion.numbers[depletion.numbers.length - 1] || [];
            const values = lastStep[matIndex] || [];
            const matches = [];
            for (let i = 0; i < nuclideInfo.length; i++) {
                const info = nuclideInfo[i];
                if (!info || !info.name) { continue; }
                if (!matchesTerms(info, terms)) { continue; }
                matches.push({ name: info.name, atoms: values[i] || 0 });
            }
            matches.sort((a, b) => b.atoms - a.atoms);
            return matches;
        }

        function renderNuclideList() {
            const list = document.getElementById('evoNucList');
            if (!list) { return; }
            const matches = evoMatchingNuclides();
            const shown = matches.slice(0, MAX_LIST_ENTRIES);
            document.getElementById('evoCount').textContent =
                matches.length === 0
                    ? 'no nuclides match'
                    : shown.length + ' of ' + matches.length + ' shown, ' + evoSelected.length + ' selected';

            list.innerHTML = shown.length === 0
                ? '<span class="empty-message">No nuclide matches this search</span>'
                : shown.map(m => '<label><input type="checkbox" value="' + escapeHtml(m.name) + '"' +
                    (evoSelected.indexOf(m.name) >= 0 ? ' checked' : '') + '>' +
                    '<span>' + escapeHtml(m.name) + '</span></label>').join('');
        }

        function renderChips() {
            const chips = document.getElementById('evoChips');
            if (!chips) { return; }
            chips.innerHTML = evoSelected.length === 0
                ? '<span class="empty-message">No nuclide selected</span>'
                : evoSelected.map(name =>
                    '<span class="chip" style="border-left-color: ' + evoColor(name) + '">' +
                    escapeHtml(name) +
                    '<button type="button" data-nuclide="' + escapeHtml(name) + '" title="Remove">&times;</button></span>').join('');
        }

        function toggleNuclide(name, selected) {
            const at = evoSelected.indexOf(name);
            if (selected && at < 0) {
                evoSelected.push(name);
            } else if (!selected && at >= 0) {
                evoSelected.splice(at, 1);
            }
        }

        function refreshEvolution() {
            renderChips();
            renderNuclideList();
            renderEvolution();
        }

        let evoChart = null;
        function renderEvolution() {
            const canvas = document.getElementById('evoChart');
            if (!canvas) { return; }
            const matIndex = parseInt(document.getElementById('evoMatSelect').value, 10);
            const logScale = document.getElementById('evoLogScale').checked;
            const labels = depletion.timeSteps.map(s => s.timeDays.toPrecision(4));

            const datasets = evoSelected.map(function (name) {
                const nucIndex = nuclideIndexByName[name];
                const color = evoColor(name);
                const values = depletion.numbers.map(function (step) {
                    const atoms = step[matIndex] ? step[matIndex][nucIndex] : null;
                    // A logarithmic axis cannot plot zero or negative values.
                    return logScale && !(atoms > 0) ? null : atoms;
                });
                return {
                    label: name,
                    data: values,
                    borderColor: color,
                    backgroundColor: color + '33',
                    tension: 0.1,
                    spanGaps: true
                };
            });

            if (evoChart) { evoChart.destroy(); evoChart = null; }
            evoChart = new Chart(canvas.getContext('2d'), {
                type: 'line',
                data: { labels: labels, datasets: datasets },
                options: {
                    responsive: true,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { display: datasets.length > 0 } },
                    scales: {
                        x: { title: { display: true, text: 'Time (days)' } },
                        y: {
                            type: logScale ? 'logarithmic' : 'linear',
                            title: { display: true, text: 'Atoms' }
                        }
                    }
                }
            });
        }

        function renderKeff() {
            const canvas = document.getElementById('keffChart');
            if (!canvas) { return; }
            const steps = depletion.timeSteps.filter(s => s.keff !== undefined && !isNaN(s.keff));
            if (steps.length === 0) { canvas.remove(); return; }
            new Chart(canvas.getContext('2d'), {
                type: 'line',
                data: {
                    labels: steps.map(s => s.timeDays.toPrecision(4)),
                    datasets: [{
                        label: 'k-effective',
                        data: steps.map(s => s.keff),
                        borderColor: '#3794ff',
                        backgroundColor: 'rgba(55, 148, 255, 0.2)',
                        tension: 0.1
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        x: { title: { display: true, text: 'Time (days)' } },
                        y: { title: { display: true, text: 'k-effective' } }
                    }
                }
            });
        }

        document.addEventListener('DOMContentLoaded', function () {
            Chart.defaults.color = getComputedStyle(document.body).getPropertyValue('--vscode-foreground') || '#cccccc';
            Chart.defaults.borderColor = getComputedStyle(document.body).getPropertyValue('--vscode-panel-border') || '#444444';

            renderKeff();

            const matSelect = document.getElementById('matSelect');
            if (matSelect) {
                const compSearch = document.getElementById('compSearch');
                matSelect.addEventListener('change', renderComposition);
                document.getElementById('stepSelect').addEventListener('change', renderComposition);
                document.getElementById('topN').addEventListener('change', renderComposition);
                document.getElementById('compHideZero').addEventListener('change', renderComposition);
                compSearch.addEventListener('input', renderComposition);
                document.getElementById('compClear').addEventListener('click', function () {
                    compSearch.value = '';
                    renderComposition();
                });
                renderComposition();
            }

            const evoMatSelect = document.getElementById('evoMatSelect');
            if (evoMatSelect) {
                const evoSearch = document.getElementById('evoSearch');

                evoMatSelect.addEventListener('change', refreshEvolution);
                document.getElementById('evoLogScale').addEventListener('change', renderEvolution);
                evoSearch.addEventListener('input', renderNuclideList);

                document.getElementById('evoNucList').addEventListener('change', function (event) {
                    const target = event.target;
                    if (!target || target.type !== 'checkbox') { return; }
                    toggleNuclide(target.value, target.checked);
                    renderChips();
                    renderNuclideList();
                    renderEvolution();
                });

                document.getElementById('evoChips').addEventListener('click', function (event) {
                    const button = event.target.closest('button[data-nuclide]');
                    if (!button) { return; }
                    toggleNuclide(button.getAttribute('data-nuclide'), false);
                    refreshEvolution();
                });

                document.getElementById('evoAddMatching').addEventListener('click', function () {
                    evoMatchingNuclides().slice(0, MAX_BULK_ADD).forEach(function (m) {
                        toggleNuclide(m.name, true);
                    });
                    refreshEvolution();
                });

                document.getElementById('evoClear').addEventListener('click', function () {
                    evoSelected.length = 0;
                    refreshEvolution();
                });

                // Start with the most abundant nuclide so the chart is not empty.
                const initial = evoMatchingNuclides()[0];
                if (initial) { toggleNuclide(initial.name, true); }
                refreshEvolution();
            }
        });
    </script>
</body>
</html>`;
    }

    private getErrorContent(errorMessage: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Error Loading Depletion Results File</title>
</head>
<body>
    <h1>Error Loading Depletion Results File</h1>
    <p>An error occurred while trying to parse the depletion results file:</p>
    <pre>${this.escapeHtml(errorMessage)}</pre>
    <p>Please ensure the file is a valid OpenMC depletion results HDF5 file.</p>
</body>
</html>`;
    }

    private formatNumber(value: number | undefined): string {
        if (value === undefined || value === null || isNaN(value)) {
            return '-';
        }
        if (value === 0) {
            return '0';
        }
        return Math.abs(value) >= 1e-3 && Math.abs(value) < 1e6
            ? value.toPrecision(6)
            : value.toExponential(4);
    }

    private formatFixed(value: number): string {
        return value.toFixed(5);
    }

    private escapeHtml(unsafe: string): string {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
}
