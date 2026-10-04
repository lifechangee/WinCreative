// selectxform module strings (en). Keys: 'selectxform.<area>.<name>'.
const dict: Record<string, string> = {
  'selectxform.action.selectPaintLayer': 'Select a paint layer',

  'selectxform.action.layerLocked': 'Layer is locked',

  'selectxform.action.makeSelection': 'Make a selection first',

  'selectxform.action.layerEmpty': 'Layer is empty',

  'selectxform.bar.layer': 'Layer',

  'selectxform.bar.canvasReference': 'Canvas (reference)',

  'selectxform.bar.source': 'Source',

  'selectxform.bar.threshold': 'tap a region, drag left/right for threshold',

  'selectxform.bar.selectionName': 'Selection name',

  'selectxform.bar.noSavedSelections': 'No saved selections',

  'selectxform.bar.automatic': 'Automatic',

  'selectxform.bar.freehand': 'Freehand',

  'selectxform.bar.rectangle': 'Rectangle',

  'selectxform.bar.ellipse': 'Ellipse',

  'selectxform.bar.square': 'Square',

  'selectxform.bar.circle': 'Circle',

  'selectxform.bar.add': 'Add',

  'selectxform.bar.addToSelection': 'Union with the existing selection',

  'selectxform.bar.remove': 'Remove',

  'selectxform.bar.subtractFromSelection': 'Subtract from the existing selection',

  'selectxform.bar.invert': 'Invert',

  'selectxform.bar.copyPaste': 'Copy & Paste',

  'selectxform.bar.copyPasteTip': 'Duplicate the selection to a new layer',

  'selectxform.bar.cutPaste': 'Cut & Paste',

  'selectxform.bar.feather': 'Feather',

  'selectxform.bar.saveLoad': 'Save & Load',

  'selectxform.bar.colorFill': 'Color Fill',

  'selectxform.bar.clear': 'Clear',

  'selectxform.bar.all': 'All',

  'selectxform.bar.layerContents': 'Layer',

  'selectxform.bar.layerContentsTip': 'Select the contents of the active layer',

  'selectxform.bar.deselect': 'Deselect',

  'selectxform.bar.mask': 'Mask',

  'selectxform.bar.close': 'Close',

  'selectxform.bar.closeTip': 'Close the polygon (Enter)',

  'selectxform.bar.cancel': 'Cancel',

  'selectxform.bar.closeToolsTip': 'Close selection tools',

  'selectxform.bar.featherApply': 'Apply',

  'selectxform.bar.featherCancel': 'Cancel',

  'selectxform.bar.featherRange': 'Feather',

  'selectxform.bar.selectionSave': 'Save',

  'selectxform.bar.selectionLoad': 'Load',

  'selectxform.bar.selectionAdd': 'Add to selection',

  'selectxform.bar.selectionSubtract': 'Subtract from selection',

  'selectxform.bar.selectionDelete': '@clear',

  'selectxform.bar.nothing': 'Nothing selected',

  'selectxform.xform.freeform': 'Freeform',

  'selectxform.xform.uniform': 'Uniform',

  'selectxform.xform.distort': 'Distort',

  'selectxform.xform.warp': 'Warp',

  'selectxform.xform.bend': 'Bend',

  'selectxform.xform.flipH': 'Flip H',

  'selectxform.xform.flipV': 'Flip V',

  'selectxform.xform.rotate45': 'Rotate 45°',

  'selectxform.xform.fitToScreen': 'Fit to Screen',

  'selectxform.xform.reset': 'Reset',

  'selectxform.xform.nearest': 'Nearest Neighbor',

  'selectxform.xform.bilinear': 'Bilinear',

  'selectxform.xform.bicubic': 'Bicubic',

  'selectxform.xform.interpolation': 'Interpolation',

  'selectxform.xform.magnetics': 'Magnetics',

  'selectxform.xform.magneticsTip': 'Snap to canvas edges / centre and rotation steps',

  'selectxform.xform.guides': 'Guides',

  'selectxform.xform.guidesTip': 'Also snap to the Drawing Guide: grid lines, symmetry axes, vanishing points',

  'selectxform.xform.distance': 'Distance',

  'selectxform.xform.velocity': 'Velocity',

  'selectxform.xform.advancedMesh': 'Advanced Mesh',

  'selectxform.xform.columns': 'Columns',

  'selectxform.xform.rows': 'Rows',

  'selectxform.xform.allLayers': 'All layers',

  'selectxform.xform.cancel': 'Cancel',

  'selectxform.xform.done': 'Done',

  'selectxform.xform.layerHidden': 'Layer is hidden',

  'selectxform.xform.nothingToTransform': 'Nothing to transform',
  'selectxform.menu.selWand': 'Automatic',
  'selectxform.menu.selFree': 'Freehand',
  'selectxform.menu.selRect': 'Rectangle',
  'selectxform.menu.selEllipse': 'Ellipse',
  'selectxform.menu.selAdd': 'Add (union mode)',
  'selectxform.menu.selRemove': 'Remove (subtract mode)',
  'selectxform.menu.selInvert': 'Invert',
  'selectxform.menu.selFeather': 'Feather...',
  'selectxform.menu.selCopy': 'Copy & Paste',
  'selectxform.menu.selCut': 'Cut & Paste',
  'selectxform.menu.selSaveload': 'Save & Load...',
  'selectxform.menu.selClear': 'Clear',
  'selectxform.menu.selAll': 'Select all',
  'selectxform.menu.selLayer': 'Select layer contents',
  'selectxform.menu.selNone': 'Deselect',
  'selectxform.menu.tfFree': 'Freeform',
  'selectxform.menu.tfUniform': 'Uniform',
  'selectxform.menu.tfDistort': 'Distort',
  'selectxform.menu.tfWarp': 'Warp',
  'selectxform.menu.tfBend': 'Warp: Bend (curve)',
  'selectxform.menu.tfMesh': 'Advanced Mesh',
  'selectxform.menu.tfFlipH': 'Flip horizontal',
  'selectxform.menu.tfFlipV': 'Flip vertical',
  'selectxform.menu.tfRot45': 'Rotate 45°',
  'selectxform.menu.tfFit': 'Fit to screen',
  'selectxform.menu.tfReset': 'Reset',
  'selectxform.menu.tfMagnetics': 'Toggle magnetics / snapping',
  'selectxform.menu.tfDone': 'Done (Enter)',
  'selectxform.menu.tfCancel': 'Cancel (Esc)',
  'selectxform.interp.nearest': 'Nearest Neighbor',
  'selectxform.interp.bilinear': 'Bilinear',
  'selectxform.interp.bicubic': 'Bicubic',
  'selectxform.threshold': 'Threshold {n}%',
  'selectxform.bar.savedName': 'Selection {n}',
  'selectxform.bar.savedDefault': 'Selection',
  'selectxform.bar.layersSel_one': '{count} layer, selection',
  'selectxform.bar.layersSel_few': '{count} layers, selection',
  'selectxform.bar.layersSel_many': '{count} layers, selection',
  'selectxform.bar.layersSel_other': '{count} layers, selection',
  'selectxform.bar.layersOnly_one': '{count} layer',
  'selectxform.bar.layersOnly_few': '{count} layers',
  'selectxform.bar.layersOnly_many': '{count} layers',
  'selectxform.bar.layersOnly_other': '{count} layers',
}
export default dict
