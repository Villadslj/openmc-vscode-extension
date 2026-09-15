# Change Log

All notable changes to the OpenMC VSCode Extension will be documented in this file.

## [Unreleased]

### Added
- Restored the depletion **Activity (Bq)** column using half-lives from the chain XML referenced by `OPENMC_CHAIN_FILE`
- Restored sortable material-composition columns, added **Show all**, and validate the complete depletion nuclide index so unnamed inventory columns are not silently hidden
- Material composition now shows total activity for the selected material or combined inventory
- 1D mesh profiles and 2D mesh heatmaps can export CSV data and PNG images
- Depletion material-composition and nuclide-evolution views can combine all materials or activation-mesh voxels into a summed inventory
- **2D Mesh Slice Histogram**: mesh tallies can now be viewed as a 2D heatmap with selectable coordinate plane (XY/XZ/YZ) and slice index, plus score, nuclide and filter bin selectors
- **Volume normalization toggle** and a **scale factor** input for the mesh slice view
- Linear/logarithmic colour scale with a colour bar, min/max readout and hover tooltips showing physical coordinates, value, σ and relative error
- Mesh geometry (dimensions, bounds, element widths, rectilinear grids) is now attached to mesh filters so it is available in the tally detail view
- Parent-nuclide selectors now show isotope names and can combine all parent bins
- Dose magnitude and time denominator can be selected independently, supporting combinations such as pSv/s, mSv/h and Sv/s
- 2D mesh heatmaps support button and mouse-wheel zoom
- Mesh tallies now include coordinate-aware 1D line profiles through 1D, 2D or 3D meshes, with fixed-axis selectors and the same parent-nuclide aggregation and unit controls as the 2D view
- Mesh result tables now show the selected line profile with physical coordinates and bounds instead of flattened mesh-bin indices

### Fixed
- Tally results are now converted from the stored sums to the true batch mean and standard deviation of the mean using `n_realizations` (previously the raw `sum` and `sum_sq` values were displayed as mean and σ)

## [0.3.0] - 2026-08-05

### Added
- **Depletion Results Viewer**: overview, time step table, k-effective chart, material composition and nuclide evolution for OpenMC depletion results files
- **Nuclide Search**: filter the Material Composition table and the Nuclide Evolution chart by element (`Pu`), mass number (`137`), full name (`Cs137`) or several terms at once (`U235 Pu239`)
- **Multi-Nuclide Evolution**: overlay any number of nuclides on the evolution chart, with an "Add matching" bulk action, removable chips and an optional logarithmic axis
- **Hide zero** toggle and adjustable row limit for the composition table

### Fixed
- Depletion files no longer open in the statepoint viewer: file type is detected from the file contents, so it works regardless of filename or `workbench.editorAssociations`
- `NaN` eigenvalues (fixed-source and decay-only runs) are reported as `-` instead of `NaN`
- `test_data/` is no longer bundled into the published `.vsix`

## [0.2.0] - 2026-02-18

### Added
- **Clickable Tally Items**: Click on any tally to view detailed information
- **Tally Detail Modal**: Comprehensive view showing:
  - Basic information (ID, name, estimator, score bins)
  - Scores and nuclides lists
  - Filter details with energy bins, cell IDs, mesh associations
  - Results summary with min/max statistics
- **Interactive Spectrum Visualization**: 
  - Multiple chart types (line, bar, scatter)
  - Logarithmic and linear scale options for both axes
  - Optional error bars (±σ)
  - Energy-dependent axis labels when energy filters are present
- **Results Data Table**: Displays bin index, x-value, mean, standard deviation, and relative error
- Keyboard navigation support (Escape to close modal)

### Changed
- Enhanced tally parsing to extract complete filter and results data
- Improved type safety with new TypeScript interfaces for tally data

## [0.1.0] - 2024-01-22

### Added
- Initial release of OpenMC Statepoint Inspector
- Custom editor for opening and viewing OpenMC statepoint HDF5 files
- Display general simulation information (version, particles, batches, etc.)
- View tallies with their IDs, scores, filters, and results
- View meshes with dimensions and spatial bounds
- Display summary statistics including k-effective
- Basic plotting capabilities with Chart.js for visualizing tally results
- Command palette integration for opening statepoint files
- Context menu integration for HDF5 files
- VSCode theme-aware UI with dark mode support

### Features
- **Statepoint File Viewer**: Open and inspect OpenMC statepoint files (`.h5`, `.hdf5`)
- **General Information Display**: View simulation parameters and runtime data
- **Tally Inspection**: Browse all tallies with their properties
- **Mesh Visualization**: Examine mesh definitions
- **Summary Statistics**: View key simulation metrics
- **Basic Charts**: Visualize tally results with bar charts
- **User-Friendly Interface**: Clean, VSCode-themed interface

## [Unreleased]

### Planned Features
- 3D mesh visualization
- Export data to CSV/JSON
- Compare multiple statepoint files
- Filter and search tallies
- Custom color themes for plots
