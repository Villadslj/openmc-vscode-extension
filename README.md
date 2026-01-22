# OpenMC VSCode Extension

A Visual Studio Code extension for inspecting OpenMC statepoint files. This extension provides a user-friendly interface to view tallies, meshes, general information, and simulation results from OpenMC HDF5 statepoint files.

## Features

- **Statepoint File Viewer**: Open and inspect OpenMC statepoint files (`.h5`, `.hdf5`)
- **General Information Display**: View simulation parameters, batch information, and runtime data
- **Tally Inspection**: Browse all tallies with their IDs, scores, filters, and results
- **Mesh Visualization**: Examine mesh definitions including dimensions and spatial bounds
- **Summary Statistics**: View key simulation metrics like k-effective and entropy
- **User-Friendly Interface**: Clean, VSCode-themed interface with organized sections

## Installation

### From VSIX
1. Download the `.vsix` file
2. Open VSCode
3. Go to Extensions view (Ctrl+Shift+X)
4. Click the "..." menu at the top
5. Select "Install from VSIX..."
6. Choose the downloaded `.vsix` file

### From Source
```bash
# Clone the repository
git clone https://github.com/Villadslj/openmc-vscode-extension.git
cd openmc-vscode-extension

# Install dependencies
npm install

# Compile the extension
npm run compile

# Package the extension (optional)
npm run package
```

## Usage

### Opening Statepoint Files

There are two ways to open statepoint files:

1. **Command Palette Method**:
   - Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
   - Type "OpenMC: Open Statepoint File"
   - Select your `.h5` or `.hdf5` file

2. **File Explorer Method**:
   - Right-click on an `.h5` file in the VSCode file explorer
   - Select "Open With..."
   - Choose "OpenMC Statepoint Viewer"

### Viewing Information

Once a statepoint file is opened, you'll see:

- **General Information**: Simulation parameters, version, number of particles, batches, etc.
- **Tallies**: List of all tallies with their properties and results
- **Meshes**: Details about mesh definitions used in the simulation
- **Summary Statistics**: Key results like k-effective value

## Requirements

- Visual Studio Code 1.75.0 or higher
- OpenMC statepoint files in HDF5 format

## Extension Settings

This extension does not add any VSCode settings at this time.

## Known Issues

- Large statepoint files may take some time to load
- Some advanced OpenMC features may not be fully displayed yet

## Development

### Building
```bash
npm run compile
```

### Packaging
```bash
npm run package
```

### Running in Development
1. Open the project in VSCode
2. Press F5 to launch the extension in a new Extension Development Host window
3. Test the extension with sample statepoint files

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

MIT

## Credits

This extension uses:
- [h5wasm](https://github.com/usnistgov/h5wasm) for reading HDF5 files
- VSCode Extension API

## Support

For issues and feature requests, please visit the [GitHub repository](https://github.com/Villadslj/openmc-vscode-extension).
