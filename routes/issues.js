/**
 * Issues Routes — 이슈 보고서 PDF 내보내기 및 CRUD
 */
'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
let handlebars;
try { handlebars = require('handlebars'); } catch (e) {}
const { asyncHandler, AppError, rateLimit } = require('../middleware');
const { authRefreshMiddleware, getHubs, getProjects, getIssueContainerInfo } = require('../services/aps.js');
const pdfRateLimit = rateLimit({
    windowMs: 60_000,
    max: 10,
    message: 'PDF 내보내기 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
});

const router = express.Router();

const GANGBUK_HUB_ID = process.env.GANGBUK_HUB_ID || 'b.4efd43ab-93fa-4448-918b-091d81dbfd75';
const GANGBUK_PROJECT_ID = process.env.GANGBUK_PROJECT_ID || 'b.d005cd39-4a35-4843-b350-81da491266ef';
const FORMA_ISSUES_CACHE_TTL_MS = Number(process.env.FORMA_ISSUES_CACHE_TTL_MS || 2 * 60 * 1000);
const FORMA_DETAIL_CACHE_TTL_MS = Number(process.env.FORMA_DETAIL_CACHE_TTL_MS || 5 * 60 * 1000);
const PLACEMENT_LOOKUP_CACHE_TTL_MS = Number(process.env.PLACEMENT_LOOKUP_CACHE_TTL_MS || 10 * 60 * 1000);
const ISSUE_SNAPSHOT_CACHE_TTL_MS = Number(process.env.ISSUE_SNAPSHOT_CACHE_TTL_MS || 10 * 60 * 1000);
const formaIssuesCache = new Map();
const formaIssueDetailCache = new Map();
const placementLookupCache = new Map();
const issueSnapshotCache = new Map();

function stripBPrefix(id) {
    return String(id || '').replace(/^b\./, '');
}

function pick(obj, paths, fallback = '') {
    for (const pathKey of paths) {
        const parts = String(pathKey).split('.');
        let cur = obj;
        for (const part of parts) {
            if (cur == null) break;
            cur = cur[part];
        }
        if (cur !== undefined && cur !== null && String(cur).trim() !== '') return cur;
    }
    return fallback;
}

function deepFindByKey(obj, keys) {
    const wanted = new Set(keys.map(k => String(k).toLowerCase()));
    const seen = new Set();
    function walk(value) {
        if (!value || typeof value !== 'object' || seen.has(value)) return '';
        seen.add(value);
        if (Array.isArray(value)) {
            for (const item of value) {
                const found = walk(item);
                if (found) return found;
            }
            return '';
        }
        for (const [key, val] of Object.entries(value)) {
            if (wanted.has(String(key).toLowerCase()) && val != null && String(val).trim() !== '') return val;
        }
        for (const val of Object.values(value)) {
            const found = walk(val);
            if (found) return found;
        }
        return '';
    }
    return walk(obj);
}

function getCustomValue(issue, names) {
    const attrs = pick(issue, ['customAttributes', 'attributes.customAttributes', 'custom_attributes'], []);
    const candidates = Array.isArray(attrs) ? attrs : Object.entries(attrs || {}).map(([title, value]) => ({ title, name: title, value }));
    const lowered = names.map(n => String(n).toLowerCase());
    for (const item of candidates) {
        const title = String(item.title || item.name || item.key || item.displayName || '').toLowerCase();
        if (lowered.includes(title)) return item.value ?? item.text ?? item.displayValue ?? '';
    }
    return '';
}

function textFromValueSafe(value) {
    if (value == null) return '';
    if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
    if (Array.isArray(value)) return value.map(textFromValueSafe).filter(Boolean).join(' > ');
    if (typeof value === 'object') {
        return textFromValueSafe(
            value.name ?? value.displayName ?? value.title ?? value.label ??
            value.value ?? value.text ?? value.displayValue ?? value.description ?? ''
        );
    }
    return String(value || '').trim();
}

function getCustomValueSafe(issue, names) {
    const attrs = pick(issue, [
        'customAttributes',
        'attributes.customAttributes',
        'custom_attributes',
        'customAttributesMap',
        'attributes.customAttributesMap',
        'customAttributeValues',
        'attributes.customAttributeValues'
    ], []);
    const candidates = Array.isArray(attrs) ? attrs : Object.entries(attrs || {}).map(([title, value]) => ({ title, name: title, value }));
    const lowered = names.map(n => String(n).toLowerCase());
    for (const item of candidates) {
        const title = String(
            item.title || item.name || item.key || item.displayName ||
            item.attributeName || item.definitionName || item.attrName ||
            item.attributeDefinition?.title || item.attributeDefinition?.name ||
            item.definition?.title || item.definition?.name || ''
        ).toLowerCase();
        if (lowered.includes(title)) {
            return textFromValueSafe(item.value ?? item.text ?? item.displayValue ?? item.selectedValue ?? item);
        }
    }
    return '';
}

function normalizeStatus(value) {
    const raw = String(value || '').trim();
    const key = raw.toLowerCase().replace(/[\s_-]+/g, '');
    const map = {
        draft: '초안',
        open: '생성',
        created: '생성',
        create: '생성',
        overdue: '지연',
        late: '지연',
        inprogress: '진행 중',
        answerprovided: '답변완료',
        answered: '답변완료',
        inreview: '검토 중',
        review: '검토 중',
        reviewinprogress: '검토 중',
        rejected: '반려',
        reject: '반려',
        needdiscussion: '협의필요',
        needsdiscussion: '협의필요',
        closed: '종료',
        close: '종료',
        completed: '종료',
        done: '종료',
        void: '종료'
    };
    return map[key] || raw || '생성';
}

function displayUser(value, userMap) {
    if (!value) return '';
    if (typeof value === 'string') return userMap.get(value) || userMap.get(value.toLowerCase()) || (value === '783606258' ? '현대건설' : value);
    const id = value.autodeskId || value.id || value.userId || value.uid || value.accountId || value.email;
    const name = value.name || value.displayName || value.fullName || [value.firstName, value.lastName].filter(Boolean).join(' ') || value.email;
    return name || userMap.get(id) || id || '';
}

function normalizeType(issue, typeMap) {
    const typeId = pick(issue, ['issueTypeId', 'issueSubtypeId', 'attributes.issueTypeId', 'attributes.issueSubtypeId', 'typeId'], '');
    if (typeId && typeMap.get(typeId)) return typeMap.get(typeId);
    const direct = pick(issue, [
        'typePath', 'issueTypePath', 'categoryPath',
        'attributes.typePath', 'attributes.issueTypePath', 'attributes.categoryPath',
        'issueType.name', 'issueSubtype.name', 'type.name',
        'attributes.issueType', 'attributes.type'
    ], '');
    if (Array.isArray(direct)) return direct.filter(Boolean).join(' > ');
    if (direct && typeof direct === 'object') return [direct.parentName, direct.name].filter(Boolean).join(' > ') || direct.name || '';
    return String(direct || '이슈').trim();
}

function normalizeTypeForForma(issue, typeMap) {
    const subtypeId = pick(issue, ['issueSubtypeId', 'attributes.issueSubtypeId', 'subtypeId', 'attributes.subtypeId'], '');
    if (subtypeId && typeMap.get(String(subtypeId))) return typeMap.get(String(subtypeId));

    const typeName = pick(issue, ['issueType.name', 'issueType.title', 'attributes.issueType.name', 'attributes.issueType.title'], '');
    const subtypeName = pick(issue, ['issueSubtype.name', 'issueSubtype.title', 'attributes.issueSubtype.name', 'attributes.issueSubtype.title'], '');
    const composed = [textFromValueSafe(typeName), textFromValueSafe(subtypeName)].filter(Boolean).join(' > ');
    if (composed) return composed;

    const typeId = pick(issue, ['issueTypeId', 'attributes.issueTypeId', 'typeId', 'attributes.typeId'], '');
    if (typeId && subtypeId) {
        const parent = typeMap.get(String(typeId)) || '';
        const child = typeMap.get(String(subtypeId)) || '';
        if (parent && child && child.indexOf(' > ') === -1 && parent !== child) return parent + ' > ' + child;
        if (child) return child;
    }
    if (typeId && typeMap.get(String(typeId))) return typeMap.get(String(typeId));

    const direct = pick(issue, [
        'typePath', 'issueTypePath', 'categoryPath', 'issueCategoryPath',
        'attributes.typePath', 'attributes.issueTypePath', 'attributes.categoryPath', 'attributes.issueCategoryPath',
        'type.name', 'type.title', 'attributes.issueType', 'attributes.type'
    ], '');
    if (Array.isArray(direct)) return direct.map(textFromValueSafe).filter(Boolean).join(' > ');
    if (direct && typeof direct === 'object') {
        const parent = direct.parentName || direct.categoryName || direct.issueTypeName || direct.typeName;
        const name = direct.name || direct.title || direct.displayName;
        return [parent, name].map(textFromValueSafe).filter(Boolean).join(' > ');
    }
    return textFromValueSafe(direct) || '이슈';
}

function normalizeLocation(issue) {
    const location = pick(issue, [
        'location',
        'locationName',
        'locationDetails',
        'location_description',
        'attributes.location',
        'attributes.locationName',
        'attributes.locationDetails',
        'attributes.location_description'
    ], '') || getCustomValue(issue, ['위치', '위치명', '구역', 'Location', 'LBS', '구조물']);
    if (typeof location === 'object') {
        return location.name || location.displayName || location.title || location.value || '';
    }
    return String(location || '').trim();
}

function normalizePlacement(issue) {
    const info = normalizePlacementInfo(issue);
    return formatPlacementInfo(info);
}

function normalizePlacementVersion(value) {
    if (value == null || value === '') return '';
    const text = String(value).trim();
    if (!text || text === '-') return '';
    const match = text.match(/^v?\s*(\d+)$/i);
    return match ? `v${match[1]}` : text;
}

function normalizePlacementUrn(value) {
    if (!value || typeof value !== 'object') return '';
    const direct = textFromValueSafe(pick(value, [
        'placements.0.tipVersionUrn',
        'placements.0.versionUrn',
        'placements.0.lineageUrn',
        'placements.0.viewable.seedURN',
        'placements.0.originContext.entityId',
        'tipVersionUrn',
        'includedVersion.urn',
        'results.0.tipVersionUrn',
        'results.0.includedVersion.urn',
        'details.viewable.urn',
        'details.viewable.versionId',
        'details.viewable.viewableUrn',
        'details.viewable.viewerUrn',
        'details.document.urn',
        'details.document.versionId',
        'details.file.urn',
        'details.file.versionId',
        'linkedDocument.details.viewable.urn',
        'linkedDocument.details.viewable.versionId'
    ], ''))
        || textFromValueSafe(value.urn)
        || textFromValueSafe(value.modelUrn)
        || textFromValueSafe(value.fileUrn)
        || textFromValueSafe(value.targetUrn)
        || textFromValueSafe(value.seedURN)
        || textFromValueSafe(value.viewableUrn)
        || textFromValueSafe(value.viewerUrn)
        || textFromValueSafe(value.versionUrn)
        || textFromValueSafe(value.documentUrn)
        || textFromValueSafe(value.documentVersionUrn)
        || textFromValueSafe(value.itemUrn)
        || textFromValueSafe(value.lineageUrn)
        || textFromValueSafe(value.documentLineageUrn)
        || textFromValueSafe(value.versionId)
        || textFromValueSafe(value.itemId);
    if (direct) return direct;
    for (const [key, val] of Object.entries(value)) {
        if (/urn|versionid|itemid|lineage/i.test(key) && val != null && typeof val !== 'object') {
            const text = textFromValueSafe(val);
            if (text) return text;
        }
    }
    return '';
}

function placementNameFromValue(value) {
    if (value == null || value === '') return '';
    if (typeof value !== 'object') return textFromValueSafe(value);
    const direct = textFromValueSafe(pick(value, [
        'placements.0.name',
        'placements.0.fileName',
        'placements.0.displayName',
        'results.0.name',
        'results.0.includedVersion.name',
        'results.0.includedVersion.uploadFileName',
        'details.viewable.name',
        'details.viewable.displayName',
        'details.viewable.fileName',
        'details.viewable.filename',
        'details.viewable.attributes.name',
        'details.viewable.attributes.displayName',
        'details.document.name',
        'details.document.displayName',
        'details.document.fileName',
        'details.file.name',
        'details.file.displayName',
        'details.file.fileName',
        'details.name',
        'details.displayName',
        'details.fileName',
        'linkedDocument.details.viewable.name',
        'linkedDocument.details.viewable.displayName',
        'linkedDocument.details.viewable.fileName'
    ], ''))
        || textFromValueSafe(value.name)
        || textFromValueSafe(value.displayName)
        || textFromValueSafe(value.title)
        || textFromValueSafe(value.fileName)
        || textFromValueSafe(value.filename)
        || textFromValueSafe(value.file_name)
        || textFromValueSafe(value.itemName)
        || textFromValueSafe(value.documentName)
        || textFromValueSafe(value.documentTitle)
        || textFromValueSafe(value.objectName)
        || textFromValueSafe(pick(value, ['attributes.name', 'attributes.displayName', 'attributes.fileName', 'attributes.file_name', 'attributes.documentName', 'attributes.documentTitle'], ''))
        || textFromValueSafe(pick(value, ['linkedDocument.name', 'linkedDocument.displayName'], ''))
        || textFromValueSafe(pick(value, ['document.name', 'document.displayName'], ''))
        || textFromValueSafe(pick(value, ['item.name', 'item.displayName'], ''))
        || textFromValueSafe(pick(value, ['version.name', 'version.displayName', 'version.attributes.name'], ''));
    if (direct) return direct;
    for (const val of Object.values(value)) {
        if (val != null && typeof val !== 'object') {
            const text = textFromValueSafe(val);
            if (isModelDocumentName(text)) return text;
        }
    }
    return '';
}

function placementVersionFromValue(value) {
    if (!value || typeof value !== 'object') return '';
    const versionFromTip = String(pick(value, ['tipVersionUrn', 'results.0.tipVersionUrn'], '') || '').match(/[?&]version=(\d+)/i);
    const placementVersionFromTip = String(pick(value, ['placements.0.tipVersionUrn', 'placements.0.versionUrn'], '') || '').match(/[?&]version=(\d+)/i);
    return normalizePlacementVersion(value.version)
        || normalizePlacementVersion(placementVersionFromTip && placementVersionFromTip[1])
        || normalizePlacementVersion(versionFromTip && versionFromTip[1])
        || normalizePlacementVersion(value.versionNumber)
        || normalizePlacementVersion(value.versionLabel)
        || normalizePlacementVersion(value.versionName)
        || normalizePlacementVersion(value.versionIndex)
        || normalizePlacementVersion(pick(value, [
            'includedVersion.versionNumber',
            'results.0.includedVersion.versionNumber',
            'results.0.versionNumber',
            'details.version',
            'details.versionNumber',
            'details.versionLabel',
            'details.viewable.version',
            'details.viewable.versionNumber',
            'details.viewable.versionLabel',
            'details.viewable.attributes.version',
            'details.viewable.attributes.versionNumber',
            'attributes.version',
            'attributes.versionNumber',
            'attributes.versionLabel',
            'attributes.versionIndex',
            'linkedDocument.version',
            'linkedDocument.versionNumber',
            'document.version',
            'document.versionNumber',
            'version.versionNumber',
            'version.attributes.versionNumber'
        ], ''));
}

function isModelDocumentName(name) {
    return /\.(rvt|ifc|dwg|nwd|nwc)$/i.test(String(name || '').trim());
}

function isGenericPlacementName(name) {
    const key = String(name || '').normalize('NFKC').trim().toLowerCase();
    return !key
        || key === '-'
        || key === 'docs'
        || key === 'autodesk docs'
        || key === 'documents'
        || key === 'files'
        || key === 'document management'
        || key === 'bim 360 docs';
}

function findModelDocumentText(value) {
    const seen = new Set();
    function walk(current) {
        if (current == null) return '';
        if (typeof current !== 'object') {
            const text = textFromValueSafe(current);
            return isModelDocumentName(text) ? text : '';
        }
        if (seen.has(current)) return '';
        seen.add(current);
        if (Array.isArray(current)) {
            for (const item of current) {
                const found = walk(item);
                if (found) return found;
            }
            return '';
        }
        for (const [key, val] of Object.entries(current)) {
            if (/href|url|link|self|related/i.test(key)) continue;
            const found = walk(val);
            if (found) return found;
        }
        return '';
    }
    return walk(value);
}

function formatPlacementInfo(info) {
    const name = textFromValueSafe(info && info.name);
    if (isGenericPlacementName(name)) return '';
    const version = normalizePlacementVersion(info && info.version);
    return version ? `${name} (${version})` : name;
}

function normalizePlacementInfo(issue) {
    const overrideName = textFromValueSafe(issue && issue.placementName);
    const overrideUrn = textFromValueSafe(issue && issue.placementUrn);
    const overrideVersion = textFromValueSafe(issue && issue.placementVersion);
    if (overrideName || overrideUrn) {
        return {
            name: isGenericPlacementName(overrideName) ? '' : overrideName,
            version: overrideVersion,
            urn: overrideUrn
        };
    }
    const direct = pick(issue, [
        'placement',
        'placementName',
        'file',
        'fileName',
        'snapshotFileName',
        'attributes.placement',
        'attributes.placementName',
        'attributes.fileName',
        'linkedDocument.name'
    ], '') || getCustomValue(issue, ['배치', 'Placement', '파일', '모델', '도면']);
    const directInfo = {
        name: findModelDocumentText(direct) || placementNameFromValue(direct),
        version: placementVersionFromValue(direct),
        urn: normalizePlacementUrn(direct) || textFromValueSafe(pick(issue, [
            'placementUrn',
            'linkedDocumentUrn',
            'documentUrn',
            'modelUrn',
            'fileUrn',
            'targetUrn',
            'versionId',
            'viewableUrn',
            'details.viewable.urn',
            'details.viewable.versionId'
        ], ''))
    };
    if (isGenericPlacementName(directInfo.name)) {
        directInfo.name = '';
    }
    const found = findPlacementInfoDeep(issue);
    if (found.name && (!directInfo.name || isModelDocumentName(found.name) || !isModelDocumentName(directInfo.name))) {
        return found;
    }
    return directInfo.name ? directInfo : found;
}

function findPlacementInfoDeep(issue) {
    const seen = new Set();
    let first = { name: '', version: '', urn: '' };
    let best = { name: '', version: '', urn: '' };
    const likelyContainers = new Set([
        'linkeddocument',
        'linkeddocuments',
        'linked_document',
        'linked_documents',
        'placement',
        'placements',
        'reference',
        'references',
        'document',
        'documents',
        'associateddocument',
        'associateddocuments',
        'attachment',
        'attachments',
        'snapshot',
        'snapshots',
        'viewable',
        'viewables',
        'file',
        'files',
        'item',
        'items'
    ]);

    function readInfo(value) {
        return {
            name: findModelDocumentText(value) || placementNameFromValue(value),
            version: placementVersionFromValue(value),
            urn: normalizePlacementUrn(value)
        };
    }

    function remember(info, key) {
        const loweredKey = String(key || '').toLowerCase();
        const isLikelyKey = likelyContainers.has(loweredKey) || /document|reference|attachment|snapshot|viewable|file|item|placement/i.test(key || '');
        if (!info.name && info.urn && isLikelyKey) {
            if (!first.urn) first = info;
            if (!best.urn) best = info;
            return;
        }
        if (!info.name) return;
        if (isGenericPlacementName(info.name)) {
            if (info.urn && isLikelyKey && !best.urn) best = { name: '', version: info.version, urn: info.urn };
            return;
        }
        if (isModelDocumentName(info.name)) {
            if (!first.name) first = info;
            best = info;
            return;
        }
        if (!isLikelyKey) return;
        if (!first.name) first = info;
        if (!best.name) best = info;
    }

    function walk(value, key = '') {
        if (!value || typeof value !== 'object' || seen.has(value) || best.name && isModelDocumentName(best.name)) return;
        seen.add(value);
        if (Array.isArray(value)) {
            for (const item of value) walk(item, key);
            return;
        }

        remember(readInfo(value), key);
        for (const [childKey, childValue] of Object.entries(value)) {
            const lowered = String(childKey).toLowerCase();
            if (likelyContainers.has(lowered) || /document|reference|attachment|snapshot|viewable|file|item/i.test(childKey)) {
                walk(childValue, childKey);
            }
        }
        for (const [childKey, childValue] of Object.entries(value)) {
            walk(childValue, childKey);
        }
    }

    walk(issue);
    return (best.name || best.urn) ? best : first;
}

function compactDebugValue(value) {
    if (value == null) return value;
    if (typeof value === 'string') return value.length > 220 ? `${value.slice(0, 220)}...` : value;
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    return textFromValueSafe(value);
}

function collectPlacementDebugPaths(issue) {
    const seen = new Set();
    const matches = [];
    const interestingKey = /placement|linked|document|docs|reference|viewable|file|filename|name|urn|version|details|pushpin|position|viewer/i;
    const interestingValue = /\.(rvt|ifc|dwg|nwd|nwc)\b|urn:adsk|adsk\.|docs/i;

    function remember(pathKey, value) {
        if (matches.length >= 120) return;
        matches.push({ path: pathKey, value: compactDebugValue(value) });
    }

    function walk(value, pathKey = '$') {
        if (matches.length >= 120 || value == null) return;
        if (typeof value !== 'object') {
            const text = String(value);
            if (interestingValue.test(text)) remember(pathKey, value);
            return;
        }
        if (seen.has(value)) return;
        seen.add(value);
        if (Array.isArray(value)) {
            value.forEach((item, index) => walk(item, `${pathKey}[${index}]`));
            return;
        }
        for (const [key, child] of Object.entries(value)) {
            const childPath = `${pathKey}.${key}`;
            if (interestingKey.test(key)) {
                if (child == null || typeof child !== 'object') remember(childPath, child);
                else {
                    const text = textFromValueSafe(child);
                    if (text && text.length < 220) remember(childPath, text);
                }
            }
            walk(child, childPath);
        }
    }

    walk(issue);
    return matches;
}

function buildPlacementDebug(issue, normalized) {
    const raw = issue && (issue.rawDetailIssue || issue.rawFormaIssue || issue);
    const detail = issue && (issue.rawDetailIssue?.data || issue.rawDetailIssue?.issue || issue.rawDetailIssue?.result || issue.rawDetailIssue);
    return {
        id: normalized.displayId || normalized.id,
        title: normalized.title,
        normalizedPlacement: normalized.placement,
        placementName: normalized.placementName,
        placementVersion: normalized.placementVersion,
        placementUrn: normalized.placementUrn,
        topLevelKeys: Object.keys(raw || {}).slice(0, 80),
        linkedDocumentsType: Array.isArray(pick(raw, ['linkedDocuments', 'data.linkedDocuments', 'attributes.linkedDocuments'], null)) ? 'array' : typeof pick(raw, ['linkedDocuments', 'data.linkedDocuments', 'attributes.linkedDocuments'], null),
        rawPaths: collectPlacementDebugPaths(raw || {}),
        detailPaths: detail && detail !== raw ? collectPlacementDebugPaths(detail) : []
    };
}

function normalizeLocationForForma(issue, locationMap = new Map()) {
    const direct = pick(issue, [
        'location',
        'locationName',
        'location.name',
        'location.displayName',
        'locationDetails',
        'locationDetail',
        'locationDescription',
        'location_description',
        'locationText',
        'lbsLocation',
        'lbsLocation.name',
        'lbsLocation.displayName',
        'attributes.location',
        'attributes.locationName',
        'attributes.location.name',
        'attributes.location.displayName',
        'attributes.locationDetails',
        'attributes.locationDetail',
        'attributes.locationDescription',
        'attributes.location_description'
    ], '');
    const custom = getCustomValueSafe(issue, ['위치', '위치명', '구역', 'Location', 'LBS', '구조물']);
    const locationId = textFromValueSafe(pick(issue, [
        'locationId',
        'location.id',
        'attributes.locationId',
        'attributes.location.id'
    ], ''));
    const mapped = locationId ? (locationMap.get(locationId) || locationMap.get(locationId.toLowerCase())) : '';
    const deep = deepFindByKey(issue, [
        'locationName',
        'locationDetails',
        'locationDetail',
        'locationDescription',
        'locationText',
        'lbsLocationName'
    ]);
    return textFromValueSafe(direct) || textFromValueSafe(custom) || textFromValueSafe(mapped) || textFromValueSafe(deep);
}

async function fetchJson(url, token, extraHeaders = {}) {
    const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...extraHeaders }
    });
    const text = await resp.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch (_) { json = { raw: text }; }
    if (!resp.ok) {
        const detail = json.detail || json.message || json.error_description || json.error || text || resp.statusText;
        throw new Error(`HTTP ${resp.status}: ${detail}`);
    }
    return json;
}

async function fetchJsonWithBody(url, token, body, extraHeaders = {}) {
    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...extraHeaders
        },
        body: JSON.stringify(body || {})
    });
    const text = await resp.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch (_) { json = { raw: text }; }
    if (!resp.ok) {
        const detail = json.detail || json.message || json.error_description || json.error || text || resp.statusText;
        throw new Error(`HTTP ${resp.status}: ${detail}`);
    }
    return json;
}

function normalizeSnapshotUrn(issue) {
    return textFromValueSafe(pick(issue, [
        'snapshotUrn',
        'snapshotURN',
        'snapshot.urn',
        'attributes.snapshotUrn',
        'attributes.snapshotURN',
        'thumbnailUrn',
        'thumbnail.urn'
    ], ''));
}

function ossUrlFromSnapshotUrn(urn) {
    const text = String(urn || '').trim();
    const match = text.match(/^urn:adsk\.objects:os\.object:([^/]+)\/(.+)$/i);
    if (!match) return '';
    return {
        bucketKey: match[1],
        objectKey: match[2],
        objectUrl: `https://developer.api.autodesk.com/oss/v2/buckets/${encodeURIComponent(match[1])}/objects/${encodeURIComponent(match[2])}`,
        signedDownloadUrl: `https://developer.api.autodesk.com/oss/v2/buckets/${encodeURIComponent(match[1])}/objects/${encodeURIComponent(match[2])}/signeds3download?minutesExpiration=10`
    };
}

async function fetchSnapshotImage(urn, token) {
    const oss = ossUrlFromSnapshotUrn(urn);
    if (!oss) throw new Error('Unsupported snapshot URN');
    const cached = issueSnapshotCache.get(urn);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const signedResp = await fetch(oss.signedDownloadUrl, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json'
        }
    });
    if (!signedResp.ok) {
        const text = await signedResp.text().catch(() => '');
        throw new Error(`signeds3download HTTP ${signedResp.status}: ${text || signedResp.statusText}`);
    }
    const signedJson = await signedResp.json();
    const signedUrl = signedJson.url || signedJson.signedUrl || signedJson.signedURL || signedJson.urls?.[0];
    if (!signedUrl) throw new Error('signeds3download response did not include a URL');

    const resp = await fetch(signedUrl, {
        headers: { Accept: 'image/*,*/*' }
    });
    if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`S3 HTTP ${resp.status}: ${text || resp.statusText}`);
    }
    const contentType = resp.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await resp.arrayBuffer());
    const value = { buffer, contentType };
    issueSnapshotCache.set(urn, { value, expiresAt: Date.now() + ISSUE_SNAPSHOT_CACHE_TTL_MS });
    return value;
}

async function fetchProjectMembers(projectId, token) {
    const cleanProjectId = stripBPrefix(projectId);
    const urls = [
        `https://developer.api.autodesk.com/construction/admin/v1/projects/${cleanProjectId}/users?limit=200`,
        `https://developer.api.autodesk.com/bim360/admin/v1/projects/${cleanProjectId}/users?limit=200`
    ];
    const map = new Map();
    for (const url of urls) {
        try {
            const json = await fetchJson(url, token);
            const rows = json.results || json.data || json.users || [];
            rows.forEach(u => {
                const name = u.name || u.displayName || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || '';
                [u.autodeskId, u.id, u.userId, u.uid, u.email].filter(Boolean).forEach(id => {
                    map.set(String(id), name);
                    map.set(String(id).toLowerCase(), name);
                });
            });
            if (map.size) return map;
        } catch (err) {
            console.warn('[Forma Issues] member fetch skipped:', err.message);
        }
    }
    map.set('783606258', '현대건설');
    map.set('783606258', '현대건설');
    return map;
}

function projectIdCandidates(projectId) {
    const original = String(projectId || '').trim();
    const clean = stripBPrefix(original);
    return Array.from(new Set([original, clean].filter(Boolean)));
}

async function fetchIssueTypeMap(projectId, containerId, token) {
    const projectIds = projectIdCandidates(projectId);
    const cleanContainerId = stripBPrefix(containerId);
    const regions = ['', 'US', 'EMEA'];
    const urls = [
        ...(cleanContainerId ? [{ url: `https://developer.api.autodesk.com/issues/v1/containers/${encodeURIComponent(cleanContainerId)}/issue-types` }] : []),
        ...projectIds.flatMap(id => regions.map(region => ({
            url: `https://developer.api.autodesk.com/construction/issues/v1/projects/${encodeURIComponent(id)}/issue-types?include=subtypes&limit=100`,
            region
        })))
    ];
    const map = new Map();
    for (const candidate of urls) {
        try {
            const headers = candidate.region ? { 'x-ads-region': candidate.region } : {};
            const json = await fetchJson(candidate.url, token, headers);
            const rows = json.results || json.data || json.issueTypes || [];
            rows.forEach(t => {
                const id = t.id || t.issueTypeId || t.attributes?.id;
                const parent = t.parentName || t.rootCauseCategory || t.attributes?.parentName || t.attributes?.categoryName || t.attributes?.parent?.name || '';
                const name = t.name || t.title || t.attributes?.name || t.attributes?.title || '';
                const pathName = t.path || t.fullName || [parent, name].filter(Boolean).join(' > ') || name;
                if (id && pathName) {
                    map.set(String(id), pathName);
                    map.set(String(id).toLowerCase(), pathName);
                }
                const subtypes = t.subtypes || t.issueSubtypes || t.attributes?.subtypes || t.attributes?.issueSubtypes || t.relationships?.subtypes?.data || [];
                subtypes.forEach(st => {
                    const subId = st.id || st.issueSubtypeId || st.attributes?.id;
                    const subName = st.name || st.title || st.attributes?.name || st.attributes?.title || '';
                    const subPath = st.path || st.fullName || [name, subName].filter(Boolean).join(' > ');
                    if (subId && subPath) {
                        map.set(String(subId), subPath);
                        map.set(String(subId).toLowerCase(), subPath);
                    }
                });
            });
        } catch (err) {
            console.warn('[Forma Issues] issue type fetch skipped:', err.message);
        }
    }
    return map;
}

async function fetchLocationMap(hubId, projectId, token) {
    const map = new Map();
    try {
        const project = await fetchJson(`https://developer.api.autodesk.com/project/v1/hubs/${encodeURIComponent(hubId)}/projects/${encodeURIComponent(projectId)}`, token);
        const rel = project.data?.relationships?.locations;
        const href = rel?.links?.related?.href || rel?.meta?.link?.href || '';
        const locationUrls = [
            href,
            `https://developer.api.autodesk.com/project/v1/hubs/${encodeURIComponent(hubId)}/projects/${encodeURIComponent(projectId)}/locations`,
            `https://developer.api.autodesk.com/project/v1/hubs/${encodeURIComponent(hubId)}/projects/${encodeURIComponent(projectId)}/topFolders`
        ].filter(Boolean);
        for (const url of locationUrls) {
            try {
                const json = await fetchJson(url, token);
                const rows = json.data || json.results || json.locations || [];
                const walk = (node, parents = []) => {
                    if (!node) return;
                    if (Array.isArray(node)) {
                        node.forEach(item => walk(item, parents));
                        return;
                    }
                    const id = node.id || node.locationId || node.attributes?.id;
                    const name = node.name || node.displayName || node.title || node.attributes?.name || node.attributes?.displayName || node.attributes?.title;
                    const pathName = [...parents, name].filter(Boolean).join(' > ');
                    if (id && pathName) {
                        map.set(String(id), pathName);
                        map.set(String(id).toLowerCase(), pathName);
                    }
                    walk(node.children || node.locations || node.data || node.attributes?.children, pathName ? [...parents, name] : parents);
                };
                walk(rows);
                if (map.size) return map;
            } catch (err) {
                console.warn('[Forma Issues] location fetch skipped:', err.message);
            }
        }
    } catch (err) {
        console.warn('[Forma Issues] project location relationship skipped:', err.message);
    }
    return map;
}

async function fetchFormaIssues(projectId, containerId, token, limit) {
    const projectIds = projectIdCandidates(projectId);
    const cleanContainerId = stripBPrefix(containerId);
    const totalLimit = Math.min(Math.max(parseInt(limit, 10) || 300, 1), 1000);
    const pageLimit = Math.min(totalLimit, 100);
    const regions = ['', 'US', 'EMEA'];
    const candidates = [
        ...(cleanContainerId ? [
            { url: `https://developer.api.autodesk.com/issues/v1/containers/${encodeURIComponent(cleanContainerId)}/issues?limit=${pageLimit}` },
            { url: `https://developer.api.autodesk.com/issues/v2/containers/${encodeURIComponent(cleanContainerId)}/issues?limit=${pageLimit}` }
        ] : []),
        ...projectIds.flatMap(id => regions.map(region => ({
            url: `https://developer.api.autodesk.com/construction/issues/v1/projects/${encodeURIComponent(id)}/issues?limit=${pageLimit}`,
            region
        }))),
        ...projectIds.flatMap(id => regions.map(region => ({
            url: `https://developer.api.autodesk.com/construction/issues/v2/projects/${encodeURIComponent(id)}/issues?limit=${pageLimit}`,
            region
        })))
    ];
    let lastError = null;
    for (const candidate of candidates) {
        try {
            const headers = candidate.region ? { 'x-ads-region': candidate.region } : {};
            const json = await fetchJson(candidate.url, token, headers);
            const rows = json.results || json.data || json.issues || [];
            return rows.slice(0, totalLimit);
        } catch (err) {
            lastError = err;
            console.warn('[Forma Issues] issue fetch failed:', candidate.url, candidate.region || 'default', err.message);
        }
    }
    throw lastError || new Error('Unable to fetch Forma issues.');
}

function mergeIssueDetail(listIssue, detailIssue) {
    if (!detailIssue || typeof detailIssue !== 'object') return listIssue;
    const detail = detailIssue.data || detailIssue.issue || detailIssue.result || detailIssue;
    if (!detail || typeof detail !== 'object') return listIssue;
    const keepListValue = (...paths) => {
        for (const pathKey of paths) {
            const value = pick(listIssue, [pathKey], '');
            if (value !== undefined && value !== null && String(value).trim() !== '') return value;
        }
        return undefined;
    };
    const listTypeId = keepListValue('issueTypeId', 'attributes.issueTypeId', 'typeId', 'attributes.typeId');
    const listSubtypeId = keepListValue('issueSubtypeId', 'attributes.issueSubtypeId', 'subtypeId', 'attributes.subtypeId');
    const listTypePath = keepListValue('typePath', 'issueTypePath', 'categoryPath', 'attributes.typePath', 'attributes.issueTypePath', 'attributes.categoryPath');
    return {
        ...listIssue,
        ...detail,
        ...(listTypeId ? { issueTypeId: listTypeId } : {}),
        ...(listSubtypeId ? { issueSubtypeId: listSubtypeId } : {}),
        ...(listTypePath ? { typePath: listTypePath } : {}),
        attributes: {
            ...(listIssue.attributes || {}),
            ...(detail.attributes || {}),
            ...(listTypeId ? { issueTypeId: listTypeId } : {}),
            ...(listSubtypeId ? { issueSubtypeId: listSubtypeId } : {}),
            ...(listTypePath ? { typePath: listTypePath } : {})
        },
        rawListIssue: listIssue,
        rawDetailIssue: detailIssue
    };
}

async function fetchFormaIssueDetail(issue, projectId, containerId, token) {
    const id = issue.id || issue.issueId || issue.attributes?.id;
    if (!id) return null;
    const cacheKey = `${projectId}|${containerId || ''}|${id}`;
    const cached = formaIssueDetailCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const projectIds = projectIdCandidates(projectId);
    const regions = ['', 'US', 'EMEA'];
    const candidates = [
        ...projectIds.flatMap(projectCandidate => regions.flatMap(region => [
            {
                url: `https://developer.api.autodesk.com/construction/issues/v1/projects/${encodeURIComponent(projectCandidate)}/issues/${encodeURIComponent(id)}`,
                region
            },
            {
                url: `https://developer.api.autodesk.com/construction/issues/v1/projects/${encodeURIComponent(projectCandidate)}/issues/${encodeURIComponent(id)}?include=linkedDocuments,references,attachments`,
                region
            },
            {
                url: `https://developer.api.autodesk.com/construction/issues/v2/projects/${encodeURIComponent(projectCandidate)}/issues/${encodeURIComponent(id)}`,
                region
            },
            {
                url: `https://developer.api.autodesk.com/construction/issues/v2/projects/${encodeURIComponent(projectCandidate)}/issues/${encodeURIComponent(id)}?include=linkedDocuments,references,attachments`,
                region
            }
        ])),
        ...(containerId ? [
            { url: `https://developer.api.autodesk.com/issues/v2/containers/${encodeURIComponent(containerId)}/issues/${encodeURIComponent(id)}?include=linkedDocuments,references,attachments` },
            { url: `https://developer.api.autodesk.com/issues/v2/containers/${encodeURIComponent(containerId)}/issues/${encodeURIComponent(id)}` },
            { url: `https://developer.api.autodesk.com/issues/v1/containers/${encodeURIComponent(containerId)}/issues/${encodeURIComponent(id)}?include=linkedDocuments,references,attachments` },
            { url: `https://developer.api.autodesk.com/issues/v1/containers/${encodeURIComponent(containerId)}/issues/${encodeURIComponent(id)}` }
        ] : [])
    ];

    for (const candidate of candidates) {
        try {
            const headers = candidate.region ? { 'x-ads-region': candidate.region } : {};
            const json = await fetchJson(candidate.url, token, headers);
            formaIssueDetailCache.set(cacheKey, { value: json, expiresAt: Date.now() + FORMA_DETAIL_CACHE_TTL_MS });
            return json;
        } catch (_) {
            // Try the next supported issues detail endpoint.
        }
    }
    return null;
}

function projectIdForDataManagement(projectId) {
    const id = String(projectId || '').trim();
    if (!id) return id;
    return id.startsWith('b.') ? id : `b.${id}`;
}

function isAutodeskDataUrn(value) {
    const text = String(value || '').trim();
    return /^urn:adsk\./i.test(text) || /^adsk\./i.test(text);
}

function dataManagementResourceType(urn) {
    const text = String(urn || '');
    if (/fs\.file|versions/i.test(text) || /[?&]version=/i.test(text)) return 'versions';
    if (/dm\.lineage|items/i.test(text)) return 'items';
    return /version/i.test(text) ? 'versions' : 'items';
}

function dataManagementNameFromJson(json) {
    const data = json && (Array.isArray(json.results) ? json.results[0] : (json.data || json));
    return textFromValueSafe(pick(data, [
        'name',
        'uploadFileName',
        'includedVersion.name',
        'includedVersion.uploadFileName',
        'attributes.displayName',
        'attributes.name',
        'attributes.extension.data.name',
        'attributes.extension.data.fileName',
        'displayName'
    ], ''));
}

function dataManagementVersionFromJson(json) {
    const data = json && (Array.isArray(json.results) ? json.results[0] : (json.data || json));
    const versionFromTip = String(pick(data, ['tipVersionUrn'], '') || '').match(/[?&]version=(\d+)/i);
    return normalizePlacementVersion(versionFromTip && versionFromTip[1])
        || normalizePlacementVersion(pick(data, [
        'attributes.versionNumber',
        'attributes.version',
        'includedVersion.versionNumber',
        'versionNumber',
        'version'
    ], ''));
}

function dataManagementUrnFromJson(json, fallbackUrn) {
    const data = json && (Array.isArray(json.results) ? json.results[0] : (json.data || json));
    return textFromValueSafe(pick(data, [
        'tipVersionUrn',
        'includedVersion.urn',
        'attributes.extension.data.versionUrn',
        'id',
        'urn'
    ], '')) || fallbackUrn;
}

async function resolvePlacementNameFromDataManagement(urn, projectId, token) {
    if (!isAutodeskDataUrn(urn)) return null;
    const project = projectIdForDataManagement(projectId);
    const rawUrn = String(urn).startsWith('urn:') ? String(urn) : `urn:${urn}`;
    const cacheKey = `${project}|${rawUrn}`;
    const cached = placementLookupCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const encoded = encodeURIComponent(rawUrn);
    const type = dataManagementResourceType(rawUrn);
    const lineageQuery = encodeURIComponent(rawUrn);
    const candidates = [
        `https://developer.api.autodesk.com/construction/files/v1/projects/${encodeURIComponent(stripBPrefix(project))}/items:batch-get`,
        `https://developer.api.autodesk.com/construction/files/v1/projects/${encodeURIComponent(project)}/items:batch-get`,
        `https://developer.api.autodesk.com/construction/files/v1/projects/${encodeURIComponent(stripBPrefix(project))}/items?filter[urn]=${lineageQuery}`,
        `https://developer.api.autodesk.com/construction/files/v1/projects/${encodeURIComponent(project)}/items?filter[urn]=${lineageQuery}`,
        `https://developer.api.autodesk.com/construction/files/v1/projects/${encodeURIComponent(stripBPrefix(project))}/items?lineageUrn=${lineageQuery}`,
        `https://developer.api.autodesk.com/construction/files/v1/projects/${encodeURIComponent(project)}/items?lineageUrn=${lineageQuery}`,
        `https://developer.api.autodesk.com/data/v1/projects/${encodeURIComponent(project)}/${type}/${encoded}`,
        type === 'versions'
            ? `https://developer.api.autodesk.com/data/v1/projects/${encodeURIComponent(project)}/versions/${encoded}/item`
            : `https://developer.api.autodesk.com/data/v1/projects/${encodeURIComponent(project)}/items/${encoded}/tip`
    ];

    for (const url of candidates) {
        try {
            const isBatch = url.includes('items:batch-get');
            const json = isBatch
                ? await fetchJsonWithBody(url, token, { urns: [rawUrn] })
                : await fetchJson(url, token, { Accept: 'application/vnd.api+json, application/json' });
            const name = dataManagementNameFromJson(json);
            if (name && !isGenericPlacementName(name)) {
                const result = {
                    name,
                    version: dataManagementVersionFromJson(json),
                    urn: dataManagementUrnFromJson(json, rawUrn)
                };
                placementLookupCache.set(cacheKey, { value: result, expiresAt: Date.now() + PLACEMENT_LOOKUP_CACHE_TTL_MS });
                return result;
            }
        } catch (err) {
            console.warn('[Forma Issues] placement DM lookup skipped:', err.message);
        }
    }
    placementLookupCache.set(cacheKey, { value: null, expiresAt: Date.now() + Math.min(60_000, PLACEMENT_LOOKUP_CACHE_TTL_MS) });
    return null;
}

async function enrichFormaIssuesWithDetails(issues, projectId, containerId, token) {
    const rows = Array.isArray(issues) ? issues : [];
    const enriched = new Array(rows.length);
    let cursor = 0;
    const workerCount = Math.min(6, Math.max(1, rows.length));

    async function worker() {
        while (cursor < rows.length) {
            const index = cursor++;
            const issue = rows[index];
            const detail = await fetchFormaIssueDetail(issue, projectId, containerId, token);
            const merged = detail ? mergeIssueDetail(issue, detail) : issue;
            const placementInfo = normalizePlacementInfo(merged);
            if (process.env.FORMA_PLACEMENT_DEBUG === '1') {
                const issueId = merged.displayId || merged.id || merged.issueId || issue.displayId || issue.id;
                console.log('[Forma Issues] placement candidate:', {
                    issueId,
                    name: placementInfo.name || '',
                    urn: placementInfo.urn || '',
                    version: placementInfo.version || '',
                    hasPlacements: Array.isArray(merged.placements),
                    placementsCount: Array.isArray(merged.placements) ? merged.placements.length : 0,
                    hasLinkedDocuments: Array.isArray(merged.linkedDocuments),
                    linkedDocumentsCount: Array.isArray(merged.linkedDocuments) ? merged.linkedDocuments.length : 0
                });
            }
            if (!formatPlacementInfo(placementInfo) && placementInfo.urn) {
                const dmInfo = await resolvePlacementNameFromDataManagement(placementInfo.urn, projectId, token);
                enriched[index] = dmInfo
                    ? { ...merged, placementName: dmInfo.name, placementVersion: dmInfo.version, placementUrn: dmInfo.urn }
                    : merged;
            } else if (placementInfo.urn && !isModelDocumentName(placementInfo.name)) {
                const dmInfo = await resolvePlacementNameFromDataManagement(placementInfo.urn, projectId, token);
                enriched[index] = dmInfo
                    ? { ...merged, placementName: dmInfo.name, placementVersion: dmInfo.version || placementInfo.version, placementUrn: dmInfo.urn }
                    : merged;
            } else {
                enriched[index] = merged;
            }
        }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return enriched.map((issue, index) => issue || rows[index]);
}

function normalizeFormaIssue(issue, typeMap, userMap) {
    const attrs = issue.attributes || {};
    const typePath = normalizeTypeForForma(issue, typeMap);
    const placementInfo = normalizePlacementInfo(issue);
    const assigneeRaw = pick(issue, ['assignedTo', 'assignee', 'assignedToUser', 'attributes.assignedTo', 'attributes.assignee', 'attributes.assignedToUser'], '');
    const creatorRaw = pick(issue, ['createdBy', 'createdByUser', 'creator', 'attributes.createdBy', 'attributes.createdByUser', 'attributes.creator'], '');
    const reviewerRaw = pick(issue, ['reviewer', 'reviewedBy', 'attributes.reviewer', 'attributes.reviewedBy'], '') || getCustomValue(issue, ['확인자', '검토자', 'Reviewer']);
    const attachments = pick(issue, ['attachments', 'attributes.attachments'], []);
    const refs = pick(issue, ['references', 'attributes.references', 'linkedDocuments'], []);
    const comments = pick(issue, ['comments', 'attributes.comments'], []);
    const id = issue.id || attrs.id || issue.issueId || issue.displayId || attrs.displayId;
    const displayId = issue.displayId || attrs.displayId || issue.issueNumber || attrs.identifier || id;

    return {
        _source: 'forma',
        _type: 'forma',
        id,
        displayId,
        dbId: displayId,
        title: pick(issue, ['title', 'attributes.title', 'name', 'attributes.name'], '제목 없음'),
        status: normalizeStatus(pick(issue, ['status', 'attributes.status', 'state', 'attributes.state'], '생성')),
        type: typePath,
        typePath,
        category: typePath,
        description: pick(issue, ['description', 'attributes.description', 'details', 'attributes.details'], ''),
        location: normalizeLocation(issue),
        assignee: displayUser(assigneeRaw, userMap),
        creator: displayUser(creatorRaw, userMap),
        reviewer: displayUser(reviewerRaw, userMap),
        createdAt: pick(issue, ['createdAt', 'attributes.createdAt', 'createdDate', 'attributes.createdDate'], ''),
        dueDate: pick(issue, ['dueDate', 'attributes.dueDate', 'endDate', 'attributes.dueDate'], ''),
        startDate: pick(issue, ['startDate', 'attributes.startDate'], ''),
        placement: formatPlacementInfo(placementInfo),
        placementName: placementInfo.name,
        placementVersion: placementInfo.version,
        placementUrn: placementInfo.urn,
        snapshotUrn: normalizeSnapshotUrn(issue),
        attachments: Array.isArray(attachments) ? attachments.length : (attachments ? String(attachments) : ''),
        references: Array.isArray(refs) ? refs.length : (refs ? String(refs) : ''),
        comments: Array.isArray(comments) ? comments.length : (comments ? String(comments) : ''),
        rawFormaIssue: issue
    };
}

// Handlebars 헬퍼
function normalizeFormaIssueForTable(issue, typeMap, userMap, locationMap = new Map()) {
    const attrs = issue.attributes || {};
    const typePath = normalizeTypeForForma(issue, typeMap);
    const placementInfo = normalizePlacementInfo(issue);
    const assigneeRaw = pick(issue, ['assignedTo', 'assignee', 'assignedToUser', 'attributes.assignedTo', 'attributes.assignee', 'attributes.assignedToUser'], '');
    const creatorRaw = pick(issue, ['createdBy', 'createdByUser', 'creator', 'attributes.createdBy', 'attributes.createdByUser', 'attributes.creator'], '');
    const reviewerRaw = pick(issue, ['reviewer', 'reviewedBy', 'attributes.reviewer', 'attributes.reviewedBy'], '') || getCustomValue(issue, ['확인자', '검토자', 'Reviewer']);
    const attachments = pick(issue, ['attachments', 'attributes.attachments'], []);
    const refs = pick(issue, ['references', 'attributes.references', 'linkedDocuments'], []);
    const comments = pick(issue, ['comments', 'attributes.comments'], []);
    const id = issue.id || attrs.id || issue.issueId || issue.displayId || attrs.displayId;
    const displayId = issue.displayId || attrs.displayId || issue.issueNumber || attrs.identifier || id;

    return {
        _source: 'forma',
        _type: 'forma',
        id,
        displayId,
        dbId: displayId,
        title: pick(issue, ['title', 'attributes.title', 'name', 'attributes.name'], '제목 없음'),
        status: normalizeStatus(pick(issue, ['status', 'attributes.status', 'state', 'attributes.state'], '생성')),
        type: typePath,
        typePath,
        category: typePath,
        description: pick(issue, ['description', 'attributes.description', 'details', 'attributes.details'], ''),
        location: normalizeLocationForForma(issue, locationMap),
        assignee: displayUser(assigneeRaw, userMap),
        creator: displayUser(creatorRaw, userMap),
        reviewer: displayUser(reviewerRaw, userMap),
        createdAt: pick(issue, ['createdAt', 'attributes.createdAt', 'createdDate', 'attributes.createdDate'], ''),
        dueDate: pick(issue, ['dueDate', 'attributes.dueDate', 'endDate'], ''),
        startDate: pick(issue, ['startDate', 'attributes.startDate'], ''),
        placement: formatPlacementInfo(placementInfo),
        placementName: placementInfo.name,
        placementVersion: placementInfo.version,
        placementUrn: placementInfo.urn,
        snapshotUrn: normalizeSnapshotUrn(issue),
        attachments: Array.isArray(attachments) ? attachments.length : (attachments ? String(attachments) : ''),
        references: Array.isArray(refs) ? refs.length : (refs ? String(refs) : ''),
        comments: Array.isArray(comments) ? comments.length : (comments ? String(comments) : ''),
        rawFormaIssue: issue
    };
}

if (handlebars) {
    handlebars.registerHelper('eq', (a, b) => a === b);
}

// GET: Fetch all issues
router.get('/api/issues', (req, res) => {
    try {
        const dataPath = path.join(__dirname, '..', 'data', 'issues.json');
        if (!fs.existsSync(dataPath)) {
            return res.json([]);
        }
        const data = fs.readFileSync(dataPath, 'utf8');
        res.json(JSON.parse(data || '[]'));
    } catch (err) {
        res.status(500).json({ error: 'Failed to read issues' });
    }
});

// GET: Forma/ACC issues for Gangbuk project, normalized for the main Issues tab.
router.get('/api/issues/forma-gangbuk', authRefreshMiddleware, async (req, res) => {
    const token = req.internalOAuthToken && req.internalOAuthToken.access_token;
    const hubId = req.query.hubId || req.query.hub_id || GANGBUK_HUB_ID;
    const projectId = req.query.projectId || req.query.project_id || GANGBUK_PROJECT_ID;
    const limit = req.query.limit || 300;
    const debugPlacement = req.query.debugPlacement === '1' || req.query.debug_placement === '1';
    const forceRefresh = req.query.refresh === '1' || req.query.force === '1' || debugPlacement;
    const cacheKey = `${hubId}|${projectId}|${limit}`;

    try {
        const cached = formaIssuesCache.get(cacheKey);
        if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
            return res.json({
                ...cached.value,
                meta: {
                    ...(cached.value.meta || {}),
                    cache: true,
                    cacheExpiresAt: new Date(cached.expiresAt).toISOString()
                }
            });
        }
        const containerId = await getIssueContainerInfo(hubId, projectId, token).catch(err => {
            console.warn('[Forma Issues] issue container lookup failed:', err.message);
            return null;
        });
        const [userMap, typeMap, locationMap, rawIssues] = await Promise.all([
            fetchProjectMembers(projectId, token),
            fetchIssueTypeMap(projectId, containerId, token),
            fetchLocationMap(hubId, projectId, token),
            fetchFormaIssues(projectId, containerId, token, limit)
        ]);
        const enrichedIssues = await enrichFormaIssuesWithDetails(rawIssues, projectId, containerId, token);
        const normalized = enrichedIssues
            .map(issue => normalizeFormaIssueForTable(issue, typeMap, userMap, locationMap))
            .filter(issue => !String(issue.typePath || issue.type || '').includes('\uAC74\uD654'))
            .filter(issue => !String(issue.typePath || issue.type || '').includes('건화'))
            .filter(issue => !String(issue.typePath || issue.type || '').includes('건화'));
        const placementDebug = debugPlacement
            ? enrichedIssues
                .map((issue, index) => buildPlacementDebug(issue, normalizeFormaIssueForTable(issue, typeMap, userMap, locationMap)))
                .filter(item => item.normalizedPlacement === '-' || !item.normalizedPlacement || item.normalizedPlacement === 'Docs' || item.rawPaths.length || item.detailPaths.length)
                .slice(0, 25)
            : undefined;

        const payload = {
            data: normalized,
            meta: {
                hubId,
                projectId,
                containerId,
                count: normalized.length,
                rawCount: rawIssues.length,
                enrichedCount: enrichedIssues.filter(issue => issue && issue.rawDetailIssue).length,
                cache: false,
                fetchedAt: new Date().toISOString(),
                ...(debugPlacement ? { placementDebug } : {}),
                excludedCategory: '건화'
            }
        };
        if (!debugPlacement) {
            formaIssuesCache.set(cacheKey, { value: payload, expiresAt: Date.now() + FORMA_ISSUES_CACHE_TTL_MS });
        }
        res.json(payload);
    } catch (err) {
        console.error('[Forma Issues] fetch failed:', err.message);
        res.status(502).json({
            error: 'Failed to fetch Forma issues',
            message: err.message,
            data: []
        });
    }
});

router.get('/api/issues/forma-gangbuk/:issueId/placement-debug', authRefreshMiddleware, async (req, res) => {
    const token = req.internalOAuthToken && req.internalOAuthToken.access_token;
    const hubId = req.query.hubId || req.query.hub_id || GANGBUK_HUB_ID;
    const projectId = req.query.projectId || req.query.project_id || GANGBUK_PROJECT_ID;
    const issueId = req.params.issueId;

    try {
        const containerId = await getIssueContainerInfo(hubId, projectId, token).catch(() => null);
        const detail = await fetchFormaIssueDetail({ id: issueId }, projectId, containerId, token);
        const issue = detail && (detail.data || detail.issue || detail.result || detail);
        const placementInfo = normalizePlacementInfo(issue || {});
        let dmInfo = null;
        if (placementInfo.urn) {
            dmInfo = await resolvePlacementNameFromDataManagement(placementInfo.urn, projectId, token).catch(err => ({
                error: err.message
            }));
        }
        const merged = dmInfo && !dmInfo.error
            ? { ...(issue || {}), placementName: dmInfo.name, placementVersion: dmInfo.version, placementUrn: dmInfo.urn }
            : (issue || {});
        const normalized = normalizeFormaIssueForTable(merged, new Map(), new Map(), new Map());
        res.json({
            issueId,
            projectId,
            containerId,
            placementInfo,
            dmInfo,
            normalized: {
                placement: normalized.placement,
                placementName: normalized.placementName,
                placementVersion: normalized.placementVersion,
                placementUrn: normalized.placementUrn,
                type: normalized.type,
                typePath: normalized.typePath
            },
            placements: issue && issue.placements,
            linkedDocuments: issue && issue.linkedDocuments,
            rawPaths: collectPlacementDebugPaths(issue || {})
        });
    } catch (err) {
        res.status(502).json({
            error: 'Failed to debug Forma placement',
            message: err.message
        });
    }
});

router.get('/api/issues/snapshot', authRefreshMiddleware, async (req, res) => {
    const token = req.internalOAuthToken && req.internalOAuthToken.access_token;
    const urn = String(req.query.urn || '').trim();
    if (!urn) return res.status(400).json({ error: 'snapshot urn is required' });

    try {
        const image = await fetchSnapshotImage(urn, token);
        res.setHeader('Content-Type', image.contentType);
        res.setHeader('Cache-Control', 'private, max-age=600');
        res.send(image.buffer);
    } catch (err) {
        console.warn('[Forma Issues] snapshot fetch failed:', err.message);
        res.status(404).json({
            error: 'SnapshotNotFound',
            message: err.message
        });
    }
});

// POST: Add or Update issue
router.post('/api/issues', (req, res) => {
    try {
        const dataPath = path.join(__dirname, '..', 'data', 'issues.json');
        const issues = fs.existsSync(dataPath) ? JSON.parse(fs.readFileSync(dataPath, 'utf8') || '[]') : [];

        const newIssue = req.body;
        const index = issues.findIndex(i => i.id === newIssue.id);

        if (index !== -1) {
            issues[index] = { ...issues[index], ...newIssue, updatedAt: new Date().toISOString() };
        } else {
            issues.push({ ...newIssue, createdAt: new Date().toISOString() });
        }

        fs.writeFileSync(dataPath, JSON.stringify(issues, null, 2), 'utf8');
        res.status(201).json(newIssue);
    } catch (err) {
        console.error('[Issues API] Save error:', err);
        res.status(500).json({ error: 'Failed to save issue' });
    }
});

// DELETE: Remove issue
router.delete('/api/issues/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const dataPath = path.join(__dirname, '..', 'data', 'issues.json');
        if (!fs.existsSync(dataPath)) return res.status(404).json({ error: 'Not found' });

        let issues = JSON.parse(fs.readFileSync(dataPath, 'utf8') || '[]');
        issues = issues.filter(i => i.id !== id);

        fs.writeFileSync(dataPath, JSON.stringify(issues, null, 2), 'utf8');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete issue' });
    }
});

// ── POST /api/issues/export-pdf ────────────────────────────────
router.post('/api/issues/export-pdf', pdfRateLimit, asyncHandler(async (req, res) => {
    const data = req.body || {};
    console.log('[Issues PDF] Export requested.');

    // Normalize: support both single-issue and array-of-issues
    const issuesRaw = Array.isArray(data.issues) ? data.issues : [data];
    if (!issuesRaw.length) throw new AppError('이슈 데이터가 비어 있습니다.', 400, 'VALIDATION_ERROR');

    const title = data.title || '이슈 해결 결과 보고서';
    const logoBase64 = data.logoBase64 || '';

    // [Field Selector] Build field visibility flags
    const rawSf = data.selectedFields || data.sf || {};
    const sf = {
        no: rawSf.no !== false && String(rawSf.no) !== 'false',
        structure: rawSf.structure !== false && String(rawSf.structure) !== 'false',
        work_type: rawSf.work_type !== false && String(rawSf.work_type) !== 'false',
        description: rawSf.description !== false && String(rawSf.description) !== 'false',
        resolution: rawSf.resolution !== false && String(rawSf.resolution) !== 'false',
        screenshot: rawSf.screenshot !== false && String(rawSf.screenshot) !== 'false'
    };

    // Pre-compute combined flag for use in HBS
    sf.hasMetaRow = sf.no || sf.structure || sf.work_type;

    // Calculate layout properties
    let totalColsCount = 0;
    if (sf.no) totalColsCount += 2;
    if (sf.structure) totalColsCount += 2;
    if (sf.work_type) totalColsCount += 2;

    sf.colspan = Math.max(1, totalColsCount - 1);
    sf.totalCols = Math.max(1, totalColsCount);
    sf.halfCols = Math.max(1, Math.floor(totalColsCount / 2));

    // Map each raw issue to the template fields
    const issues = issuesRaw.map((issue, idx) => {
        // [Greedy Extraction Strategy]
        const rawStruct = (issue.structure_name || issue.structureName || issue.structure || issue.struct || issue.Structure || '').toString().trim();
        const rawWork = (issue.work_type || issue.workType || issue.work_Type || issue.worktype || issue.WorkType || '').toString().trim();

        const valStruct = rawStruct || '-';
        const valWork = rawWork || '-';
        const valIssueNum = (issue.issue_number || issue.issueNumber || issue.dbId || issue.id || (idx + 1)).toString().trim();

        return {
            issueId: valIssueNum,
            status: issue.status || 'Open',
            pdf_structure: valStruct,
            pdf_work_type: valWork,
            description: issue.description || '내용 없음',
            resolution_description: issue.resolutionDesc || issue.resolution_description || '내용 없음',
            thumbnail: issue.thumbnail || '',
            after_snapshot_url: issue.afterThumbnail || issue.after_snapshot_url || '',
            isDualImage: (issue.isComparison === true || issue.isComparison === 'true') || (issue.status === 'Closed'),
            versionA: issue.versionA || 'Before',
            versionB: issue.versionB || 'After',
            imageTableRows: issue.imageTableRows || ''
        };
    });

    const templateData = { title, logoBase64, issues, sf };
    const templatePath = path.join(__dirname, '..', 'views', 'issue-report.hbs');

    const templateHtml = fs.readFileSync(templatePath, 'utf8');
    const template = handlebars.compile(templateHtml);
    const html = template(templateData);

    // Puppeteer: Windows/ngrok 환경 호환성 유지, 안전한 타임아웃
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        timeout: 90000
    });

    try {
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(90000);
        await page.setContent(html, { waitUntil: 'networkidle0', timeout: 90000 });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            landscape: true,
            printBackground: true,
            margin: { top: '0', right: '0', bottom: '0', left: '0' },
        });

        const filename = issues.length === 1
            ? `issue_report_${issuesRaw[0].id || 'export'}.pdf`
            : `issue_report_batch_${Date.now()}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(Buffer.from(pdfBuffer));
    } finally {
        await browser.close().catch(() => {});
    }
}));

module.exports = router;
