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
                <td>${step.keff !== undefined ? this.formatFixed(step.keff) + (step.keffStdDev ? ' ± ' + this.formatFixed(step.keffStdDev) : '') : '-'}</td>
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
            margin-right: 10px;
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
        <div>
            <label>Material</label>
            <select id="matSelect">${materialOptions}</select>
            <label>Step</label>
            <select id="stepSelect">${stepOptions}</select>
            <label>Top nuclides</label>
            <input id="topN" type="number" min="1" max="200" value="25" style="width: 70px;">
        </div>
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
        <div>
            <label>Material</label>
            <select id="evoMatSelect">${materialOptions}</select>
            <label>Nuclide</label>
            <select id="evoNucSelect"></select>
        </div>
        <div class="chart-container"><canvas id="evoChart" height="110"></canvas></div>
        ` : '<div class="empty-message">No composition data found</div>'}
    </div>

    <script>
        const depletion = ${payload};
        const BARN_CM = 1e-24;

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

        function renderComposition() {
            const body = document.getElementById('compBody');
            if (!body) { return; }
            const matIndex = parseInt(document.getElementById('matSelect').value, 10);
            const stepIndex = parseInt(document.getElementById('stepSelect').value, 10);
            const topN = Math.max(1, parseInt(document.getElementById('topN').value, 10) || 25);
            const step = depletion.numbers[stepIndex];
            if (!step || !step[matIndex]) {
                body.innerHTML = '<tr><td colspan="4">No data for this selection</td></tr>';
                return;
            }
            const values = step[matIndex];
            const total = values.reduce((a, b) => a + b, 0);
            const material = materialByIndex(matIndex);
            const volume = material && material.volume ? material.volume : null;

            const rows = values.map((v, i) => ({ nuclide: depletion.nuclides[i] || ('nuclide ' + i), atoms: v }))
                .filter(r => r.atoms > 0)
                .sort((a, b) => b.atoms - a.atoms)
                .slice(0, topN);

            body.innerHTML = rows.length === 0
                ? '<tr><td colspan="4">All nuclide densities are zero</td></tr>'
                : rows.map(r => '<tr><td>' + escapeHtml(r.nuclide) + '</td><td>' + fmt(r.atoms) + '</td><td>' +
                    (volume ? fmt(r.atoms / volume * BARN_CM) : '-') + '</td><td>' +
                    (total > 0 ? (100 * r.atoms / total).toFixed(4) + ' %' : '-') + '</td></tr>').join('');
        }

        function populateNuclideSelect() {
            const select = document.getElementById('evoNucSelect');
            if (!select) { return; }
            const matIndex = parseInt(document.getElementById('evoMatSelect').value, 10);
            const lastStep = depletion.numbers[depletion.numbers.length - 1];
            const values = (lastStep && lastStep[matIndex]) || [];
            const previous = select.value;
            const options = depletion.nuclides
                .map((nuc, i) => ({ nuc: nuc, atoms: values[i] || 0 }))
                .filter(o => o.nuc)
                .sort((a, b) => b.atoms - a.atoms);
            select.innerHTML = options.map(o => '<option value="' + escapeHtml(o.nuc) + '">' + escapeHtml(o.nuc) + '</option>').join('');
            if (previous && options.some(o => o.nuc === previous)) {
                select.value = previous;
            }
        }

        let evoChart = null;
        function renderEvolution() {
            const canvas = document.getElementById('evoChart');
            if (!canvas) { return; }
            const matIndex = parseInt(document.getElementById('evoMatSelect').value, 10);
            const nuclide = document.getElementById('evoNucSelect').value;
            const nucIndex = depletion.nuclides.indexOf(nuclide);
            if (nucIndex < 0) { return; }

            const labels = depletion.timeSteps.map(s => s.timeDays.toPrecision(4));
            const values = depletion.numbers.map(step => (step[matIndex] ? step[matIndex][nucIndex] : null));

            if (evoChart) { evoChart.destroy(); }
            evoChart = new Chart(canvas.getContext('2d'), {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: nuclide + ' atoms',
                        data: values,
                        borderColor: '#4e9a06',
                        backgroundColor: 'rgba(78, 154, 6, 0.2)',
                        tension: 0.1
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        x: { title: { display: true, text: 'Time (days)' } },
                        y: { title: { display: true, text: 'Atoms' } }
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
                matSelect.addEventListener('change', renderComposition);
                document.getElementById('stepSelect').addEventListener('change', renderComposition);
                document.getElementById('topN').addEventListener('change', renderComposition);
                renderComposition();
            }

            const evoMatSelect = document.getElementById('evoMatSelect');
            if (evoMatSelect) {
                evoMatSelect.addEventListener('change', function () {
                    populateNuclideSelect();
                    renderEvolution();
                });
                document.getElementById('evoNucSelect').addEventListener('change', renderEvolution);
                populateNuclideSelect();
                renderEvolution();
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
