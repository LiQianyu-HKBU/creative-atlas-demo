'use strict';
const $ = id => document.getElementById(id);
const display = value => value === null || value === undefined || value === '' ? 'Unavailable' : String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
const missing = value => value === null || value === undefined || value === '';
const views = value => missing(value) ? 'Unavailable' : Number(value).toLocaleString(undefined, {maximumFractionDigits: 0});
const short = (value, length) => { const chars = Array.from(display(value)); return chars.length > length ? chars.slice(0, length).join('') + '…' : chars.join(''); };
const colors = {video: '#125f53', aspect: '#ae6128', evidence: '#5967bd'};
const ns = 'http://www.w3.org/2000/svg';
const labelMeasure = document.createElement('canvas').getContext('2d');
labelMeasure.font = '12px system-ui';
function graphLabel(value, width) {
  const label = display(value), chars = Array.from(label);
  if (labelMeasure.measureText(label).width <= width) return label;
  while (chars.length && labelMeasure.measureText(chars.join('') + '…').width > width) chars.pop();
  return chars.join('') + '…';
}
let videos = [], selected = null, graphData = null, selectedNodeId = null;
let loadVersion = 0, predictionVersion = 0, predicting = false, lastPrediction = null;
let scale = 1, panX = 0, panY = 0, drag = null, worldHeight = 640, positions = new Map();
let visibleNodes = [], visibleEdges = [];
let canvasWidth = 1100, canvasHeight = 640;

let savedPredictions = {};
async function loadJSON(path) {
  const response = await fetch(new URL(path, document.baseURI));
  if (!response.ok) throw new Error(`Unable to load display data (${response.status})`);
  return response.json();
}
function text(tag, value, className) { const node = document.createElement(tag); node.textContent = display(value); if (className) node.className = className; return node; }
function svg(tag, attributes) { const node = document.createElementNS(ns, tag); Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value)); return node; }
function matches() {
  const query = $('search').value.toLocaleLowerCase();
  return videos.filter(v => (!$('brand').value || v.brand === $('brand').value) &&
    (!$('validation-only').checked || v.can_predict) &&
    `${display(v.title)} ${v.video_id}`.toLocaleLowerCase().includes(query));
}
function renderLibrary(filtered = matches()) {
  $('video-count').textContent = `${filtered.length} / ${videos.length} videos`;
  $('video-list').replaceChildren();
  filtered.forEach(video => {
    const button = text('button', video.title, 'video-choice' + (selected?.video_id === video.video_id ? ' selected' : ''));
    button.setAttribute('aria-pressed', String(selected?.video_id === video.video_id));
    button.append(text('small', `${display(video.brand)} · ${video.split}${video.can_predict ? ' · saved predictions' : ''}`));
    button.onclick = () => choose(video);
    $('video-list').append(button);
  });
  if (!filtered.length) $('video-list').append(text('p', 'No matching videos. Change or clear filters.', 'hint'));
}
async function reconcileLibrary() {
  const filtered = matches();
  if (!filtered.length) clearSelection();
  else if (!selected || !filtered.some(v => v.video_id === selected.video_id)) await choose(filtered[0]);
  renderLibrary(filtered);
}
function clearPrediction() {
  predictionVersion++; lastPrediction = null;
  $('predicted-views').textContent = 'Not selected';
  $('predicted-log').textContent = 'Choose a validation video and view its saved result.';
  $('precise-output').replaceChildren(text('dt', 'Status'), text('dd', 'Not selected'));
  $('prediction-status').classList.remove('error');
}
function availability() { $('predict').disabled = predicting || !selected?.can_predict; }
function clearSelection() {
  loadVersion++; selected = null; graphData = null; selectedNodeId = null;
  clearPrediction(); availability();
  $('graph-content').hidden = true; $('selection-empty').hidden = false;
  $('video-brand').textContent = 'GRAPH EXPLORER'; $('video-title').textContent = 'No video selected';
  $('video-meta').textContent = ''; $('split-badge').textContent = '';
  $('viewport').replaceChildren(); $('node-picker').replaceChildren();
  $('node-details').replaceChildren(); $('raw-fields').replaceChildren(); $('neighbor-list').replaceChildren();
  $('prediction-context').textContent = 'No video selected. Change or clear library filters.';
  $('prediction-status').textContent = 'Select a validation video to view a saved prediction.';
  $('observed-views').textContent = 'Unavailable'; $('observed-capture').textContent = 'Captured at: Unavailable';
}
async function choose(video) {
  selected = video; graphData = null; selectedNodeId = null;
  const version = ++loadVersion;
  clearPrediction(); availability(); renderLibrary();
  $('graph-content').hidden = false; $('selection-empty').hidden = true;
  $('video-title').textContent = display(video.title); $('video-brand').textContent = display(video.brand);
  $('video-meta').textContent = `${video.video_id} · Published: ${display(video.publish_date)}`;
  $('split-badge').textContent = `${video.split} split`;
  $('prediction-context').textContent = `${display(video.title)} · ${video.split} split`;
  $('prediction-status').textContent = video.can_predict ? 'Ready to display this video’s saved model result. No model runs in this edition.' : 'This edition shows saved predictions for the 20 validation videos only.';
  $('observed-views').textContent = views(video.historical_views);
  $('observed-capture').textContent = `Captured at: ${display(video.captured_at)}`;
  $('viewport').replaceChildren(); $('node-picker').replaceChildren(); $('node-details').replaceChildren(); $('raw-fields').replaceChildren(); $('neighbor-list').replaceChildren();
  $('detail-heading').textContent = 'Node details'; $('detail-status').textContent = 'Loading graph…';
  $('graph-empty').hidden = true; $('graph-count').textContent = 'Loading one structural subgraph…';
  try {
    const data = await loadJSON(video.graph_file);
    if (version !== loadVersion) return;
    graphData = data; selectedNodeId = data.nodes.find(n => n.node_kind === 'video')?.node_id;
    drawGraph(true);
  } catch (error) { if (version === loadVersion) { $('graph-count').textContent = `Graph unavailable: ${error.message}`; $('detail-status').textContent = 'No graph loaded.'; } }
}
function neighborsOf(id) {
  const ids = new Set([id]);
  graphData?.edges.forEach(edge => { if (edge.source_node_id === id) ids.add(edge.target_node_id); if (edge.target_node_id === id) ids.add(edge.source_node_id); });
  return ids;
}
function nodeLabel(node) {
  const index = graphData.nodes.filter(n => n.node_kind === node.node_kind).findIndex(n => n.node_id === node.node_id) + 1;
  const name = node.node_kind === 'video' ? selected.title : node.node_kind === 'aspect' ? `${node.aspect_type}: ${node.aspect_value}` : `${node.evidence_kind}: ${node.text}`;
  return `${node.node_kind[0].toUpperCase()}${String(index).padStart(2, '0')} · ${display(name)}`;
}
function drawGraph(reset = false) {
  if (!graphData) return;
  const enabled = new Set([...document.querySelectorAll('[data-kind]:checked')].map(input => input.dataset.kind));
  const base = graphData.nodes.filter(n => enabled.has(n.node_kind));
  if (!base.some(n => n.node_id === selectedNodeId)) selectedNodeId = base[0]?.node_id || null;
  const neighborhood = neighborsOf(selectedNodeId);
  visibleNodes = base.filter(n => !$('neighborhood-only').checked || neighborhood.has(n.node_id));
  const ids = new Set(visibleNodes.map(n => n.node_id));
  visibleEdges = graphData.edges.filter(e => ids.has(e.source_node_id) && ids.has(e.target_node_id));
  $('graph-empty').hidden = visibleNodes.length > 0;
  $('graph-count').textContent = `${visibleNodes.length} / ${graphData.nodes.length} nodes · ${visibleEdges.length} / ${graphData.edges.length} structural edges visible · visual filters only`;
  const groups = ['video', 'aspect', 'evidence'].map(kind => visibleNodes.filter(n => n.node_kind === kind));
  canvasWidth = $('graph').clientWidth || 1100; canvasHeight = $('graph').clientHeight || 500;
  $('graph').setAttribute('viewBox', `0 0 ${canvasWidth} ${canvasHeight}`);
  const narrow = canvasWidth < 600;
  worldHeight = Math.max(canvasHeight, (narrow ? visibleNodes.length * 42 : Math.max(...groups.map(g => g.length)) * 38) + 80);
  positions = new Map();
  if (narrow) {
    const ordered = groups.flat();
    ordered.forEach((node, index) => positions.set(node.node_id, {x: 28, y: (worldHeight - ordered.length * 42) / 2 + 21 + index * 42}));
  } else {
    groups.forEach((group, column) => group.forEach((node, index) => positions.set(node.node_id, {
      x: [28, canvasWidth * .33, canvasWidth * .67][column], y: group.length === 1 ? worldHeight / 2 : 40 + index * (worldHeight - 80) / (group.length - 1)
    })));
  }
  const viewport = $('viewport'); viewport.replaceChildren();
  visibleEdges.forEach(edge => {
    const a = positions.get(edge.source_node_id), b = positions.get(edge.target_node_id);
    const connected = edge.source_node_id === selectedNodeId || edge.target_node_id === selectedNodeId;
    const line = svg('line', {x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      class: `edge ${connected ? 'connected' : 'dim'}`, 'data-edge-type': edge.edge_type,
      stroke: edge.edge_type === 'video_has_aspect' ? colors.aspect : edge.edge_type === 'video_has_evidence' ? colors.evidence : '#6b8564',
      'stroke-dasharray': edge.edge_type === 'video_has_evidence' ? '7 4' : edge.edge_type === 'aspect_supported_by_evidence' ? '2 4' : 'none'});
    const title = svg('title', {}); title.textContent = edge.edge_type; line.append(title); viewport.append(line);
  });
  $('node-picker').replaceChildren();
  visibleNodes.forEach(node => {
    const p = positions.get(node.node_id), label = nodeLabel(node);
    const group = svg('g', {class: `node${node.node_id === selectedNodeId ? ' selected' : ''}${neighborhood.has(node.node_id) ? ' neighbor' : ' dim'}`,
      tabindex: '0', role: 'button', 'aria-label': short(label, 180), 'data-node-id': node.node_id, 'data-kind': node.node_kind});
    group.append(svg('circle', {cx: p.x, cy: p.y, r: node.node_kind === 'video' ? 14 : 7, fill: colors[node.node_kind]}));
    const labelWidth = narrow ? canvasWidth - 65 : canvasWidth * .3 - 24;
    const caption = svg('text', {x: p.x + 18, y: p.y + 4}); caption.textContent = graphLabel(label, labelWidth); group.append(caption);
    const title = svg('title', {}); title.textContent = label; group.append(title);
    group.onclick = () => selectNode(node.node_id);
    group.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectNode(node.node_id); } };
    viewport.append(group);
    const option = text('option', short(label, 130)); option.value = node.node_id; $('node-picker').append(option);
  });
  $('node-picker').disabled = visibleNodes.length === 0;
  if (selectedNodeId) $('node-picker').value = selectedNodeId;
  renderDetails();
  if (reset) fitOverview();
}
const fieldsByType = {
  video: ['title', 'brand_family', 'youtube_video_id'],
  aspect: ['aspect_type', 'aspect_family', 'aspect_value', 'aspect_value_normalized'],
  evidence: ['evidence_kind', 'evidence_lane', 'text', 'text_contains_http']
};
function fieldState(node, key) {
  if (!missing(node[key])) return {value: display(node[key]), className: ''};
  const owner = Object.keys(fieldsByType).find(kind => fieldsByType[kind].includes(key));
  return owner && owner !== node.node_kind ? {value: 'Not applicable', className: 'na'} : {value: 'Unavailable', className: 'missing'};
}
function addField(list, node, key) { const state = fieldState(node, key); list.append(text('dt', key), text('dd', state.value, state.className)); }
function renderDetails() {
  const node = graphData?.nodes.find(n => n.node_id === selectedNodeId);
  $('node-details').replaceChildren(); $('raw-fields').replaceChildren(); $('neighbor-list').replaceChildren();
  if (!node) { $('detail-heading').textContent = 'No visible node selected'; $('detail-status').textContent = 'Re-enable a node type to inspect details.'; $('neighbor-summary').textContent = 'No visible selection.'; return; }
  $('detail-heading').textContent = `${node.node_kind[0].toUpperCase() + node.node_kind.slice(1)} details`;
  $('detail-status').textContent = 'Applicable fields below. Blank source fields for other node types are marked “Not applicable” under All source fields.';
  ['node_id', 'node_kind', 'video_id', ...fieldsByType[node.node_kind], 'source_package', 'source_version'].forEach(key => addField($('node-details'), node, key));
  Object.keys(node).forEach(key => addField($('raw-fields'), node, key));
  const allIds = neighborsOf(node.node_id); allIds.delete(node.node_id);
  const visibleIds = new Set(visibleNodes.map(n => n.node_id));
  $('neighbor-summary').textContent = `${allIds.size} direct neighbors · ${[...allIds].filter(id => visibleIds.has(id)).length} visible. Hidden types stay out of the drawing.`;
  graphData.nodes.filter(n => allIds.has(n.node_id)).forEach(neighbor => {
    const button = text('button', short(nodeLabel(neighbor), 140));
    button.disabled = !visibleIds.has(neighbor.node_id);
    button.onclick = () => { selectNode(neighbor.node_id); readLabels(); };
    $('neighbor-list').append(button);
  });
  if (!allIds.size) $('neighbor-list').append(text('p', 'No direct neighbors.', 'hint'));
}
function selectNode(id) { selectedNodeId = id; drawGraph(false); }
function transform() { $('viewport').setAttribute('transform', `translate(${panX} ${panY}) scale(${scale})`); }
function fitOverview() { scale = Math.min(1, (canvasHeight - 30) / worldHeight); panX = (canvasWidth - canvasWidth * scale) / 2; panY = (canvasHeight - worldHeight * scale) / 2; transform(); }
function readLabels() { scale = 1; panX = 0; panY = canvasHeight / 2 - (positions.get(selectedNodeId)?.y || canvasHeight / 2); transform(); }
function zoom(factor) { const next = Math.max(.03, Math.min(8, scale * factor)); const x = canvasWidth / 2, y = canvasHeight / 2; panX = x - (x - panX) * next / scale; panY = y - (y - panY) * next / scale; scale = next; transform(); }
function point(event) { return new DOMPoint(event.clientX, event.clientY).matrixTransform($('graph').getScreenCTM().inverse()); }
$('zoom-in').onclick = () => zoom(1.25); $('zoom-out').onclick = () => zoom(.8); $('fit').onclick = fitOverview; $('read-labels').onclick = readLabels;
$('graph').addEventListener('wheel', event => { event.preventDefault(); zoom(event.deltaY < 0 ? 1.15 : 1 / 1.15); }, {passive: false});
$('graph').onpointerdown = event => { if (event.target.closest('.node')) return; drag = point(event); $('graph').setPointerCapture(event.pointerId); };
$('graph').onpointermove = event => { if (!drag) return; const p = point(event); panX += p.x - drag.x; panY += p.y - drag.y; drag = p; transform(); };
$('graph').onpointerup = $('graph').onpointercancel = () => { drag = null; };
$('node-picker').onchange = () => { selectNode($('node-picker').value); readLabels(); };
window.addEventListener('resize', () => { if (graphData) drawGraph(true); });
document.querySelectorAll('input[data-kind]').forEach(input => input.onchange = () => drawGraph(true));
$('neighborhood-only').onchange = () => drawGraph(true);
['brand', 'validation-only'].forEach(id => $(id).onchange = reconcileLibrary);
$('search').oninput = reconcileLibrary;
$('clear-filters').onclick = () => { $('brand').value = ''; $('search').value = ''; $('validation-only').checked = false; reconcileLibrary(); };
$('model').onchange = () => { clearPrediction(); $('prediction-status').textContent = selected?.can_predict ? 'Model changed. Select “Show saved prediction” to view its saved result.' : 'Saved prediction unavailable for this selection.'; };
$('predict').onclick = async () => {
  if (!selected?.can_predict || predicting) return;
  clearPrediction();
  const videoId = selected.video_id, model = $('model').value, version = predictionVersion;
  predicting = true; availability(); $('prediction-status').textContent = 'Loading saved prediction…';
  try {
    const result = savedPredictions[videoId]?.[model];
    if (!result) throw new Error('No saved result is available for this selection.');
    if (version !== predictionVersion || selected?.video_id !== videoId || $('model').value !== model) return;
    lastPrediction = result;
    $('predicted-views').textContent = views(result.estimated_views);
    $('predicted-log').textContent = `Predicted log1p(views): ${result.log1p_views.toFixed(8)}`;
    $('prediction-status').textContent = `${result.model} · saved validation prediction · no model execution.`;
    $('precise-output').replaceChildren(text('dt', 'Source'), text('dd', result.source), text('dt', 'log1p(views)'), text('dd', String(result.log1p_views)), text('dt', 'expm1 estimate'), text('dd', String(result.estimated_views)));
  } catch (error) { if (version === predictionVersion) { $('prediction-status').textContent = error.message; $('prediction-status').classList.add('error'); } }
  finally { predicting = false; availability(); }
};
function renderMetrics(data) {
  const names = {'GNN-structural+similarity': 'Similarity GNN', 'GNN-structural': 'Structural GNN', GradientBoosting: 'Gradient boosting', Ridge: 'Ridge'};
  ['val', 'test'].forEach(split => {
    const body = $(split === 'val' ? 'validation-metrics' : 'test-metrics');
    data.comparison.forEach(row => {
      const tr = document.createElement('tr'), label = text('td', names[row.model]);
      if (row.model === 'GNN-structural+similarity') { tr.className = 'selected-model'; label.append(text('span', 'Validation-selected', 'model-tag')); }
      tr.append(label);
      ['MAE', 'RMSE', 'Spearman'].forEach(metric => tr.append(text('td', missing(row[`${split}_${metric}`]) ? null : row[`${split}_${metric}`].toFixed(4))));
      body.append(tr);
    });
  });
}
async function start() {
  try {
    const [library, metrics, predictions] = await Promise.all([loadJSON('data/videos.json'), loadJSON('data/metrics.json'), loadJSON('data/predictions.json')]);
    savedPredictions = predictions;
    videos = library.videos;
    const brands = [...new Set(videos.map(v => v.brand))].sort(); $('brand-count').textContent = brands.length;
    brands.forEach(brand => { const option = text('option', brand); option.value = brand || ''; $('brand').append(option); });
    renderMetrics(metrics);
    await choose(videos.find(v => v.can_predict) || videos[0]);
  } catch (error) { clearSelection(); $('video-title').textContent = 'Unable to load the collection'; $('selection-empty').textContent = error.message; }
}
start();
