'use strict';

const { createHash } = require('node:crypto');
const XLSX = require('xlsx');

const xmlNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const worksheetRel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';
const inputColumns = ['H', 'I', 'J', 'K'];
const extrasPath = '/xl/worksheets/scpda-extra.xml';
const headers = ['ลำดับ', 'รหัส', 'ชื่อสินค้า', 'BARCODE', 'หน่วย', 'จำนวน', 'ประเภท', 'รวมนับช่องนี้', 'นับ1', 'นับ2', 'นับ3'];

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

function xmlPart(zip, path) {
  const entry = XLSX.CFB.find(zip, path);
  if (!entry) throw Error(`XLSX part missing: ${path}`);
  return Buffer.from(entry.content).toString('utf8');
}

function updatePart(zip, path, xml) {
  const entry = XLSX.CFB.find(zip, path);
  if (!entry) throw Error(`XLSX part missing: ${path}`);
  entry.content = Buffer.from(xml, 'utf8');
  entry.size = entry.content.length;
}

function addXml(xml, closingTag, content) {
  if (!xml.includes(closingTag)) throw Error('Unexpected XLSX XML layout');
  return xml.replace(closingTag, () => content + closingTag);
}

function clearFilterCriteria(xml) {
  return xml.replace(/<autoFilter\b([^>]*?)(?<!\/)>(?:[^]*?)<\/autoFilter>/g, '<autoFilter$1/>');
}

// Called for files prepared by the count-form workflow on the trusted operator host.
function validateTemplate(bytes, items, { branch, warehouse }) {
  const book = XLSX.read(bytes, { type: 'buffer', WTF: true });
  if (book.SheetNames.length !== 1) throw Error('ต้องใช้ต้นแบบที่มีแท็บใบนับเพียงแท็บเดียว');
  const sheet = book.Sheets[book.SheetNames[0]];
  const title = String(sheet.A1?.v ?? '');
  if (!title.includes(`สาขา ${branch}`) || !title.includes(`คลัง ${warehouse}`)) throw Error('สาขาหรือคลังในต้นแบบไม่ตรงกับอีเวนท์');
  for (const [index, name] of headers.entries()) {
    if (sheet[XLSX.utils.encode_cell({ r: 1, c: index })]?.v !== name) throw Error(`หัวคอลัมน์ ${name} ไม่ตรงกับต้นแบบ`);
  }
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const workbookRows = [];
  for (let number = 3; number <= range.e.r + 1; number++) {
    if (sheet[`B${number}`]?.v != null) workbookRows.push(number);
  }
  if (workbookRows.length !== items.length) throw Error('จำนวนรายการในต้นแบบและผังหน้าไม่ตรงกัน');
  for (const [index, item] of items.entries()) {
    if (workbookRows[index] !== item.row ||
        String(sheet[`A${item.row}`]?.v ?? '') !== String(index + 1) ||
        ['code', 'name', 'barcode', 'unit'].some((key, i) => {
          const value = sheet[`${'BCDE'[i]}${item.row}`]?.v;
          return (key === 'name' && typeof value === 'string' ? value.replace(/[\r\n]+$/, '') : value) !== item[key];
        }) ||
        (sheet[`G${item.row}`]?.v || '') !== item.type) {
      throw Error(`สินค้าในต้นแบบไม่ตรงกับผังหน้าที่แถว ${item.row}`);
    }
    if (['F', ...inputColumns].some(col => {
      const cell = sheet[`${col}${item.row}`];
      return cell?.f || (cell?.v != null && cell.v !== '');
    })) throw Error(`ต้นแบบมีข้อมูลนับอยู่แล้วที่แถว ${item.row}`);
  }
  const zip = XLSX.CFB.read(bytes, { type: 'buffer' });
  const workbook = xmlPart(zip, '/xl/workbook.xml');
  const sheetXml = xmlPart(zip, '/xl/worksheets/sheet1.xml');
  const relationships = xmlPart(zip, '/xl/_rels/workbook.xml.rels');
  if (!workbook.includes('Print_Area') || !workbook.includes('Print_Titles') ||
      !/<pageSetup\b[^>]*\bpaperSize="9"/.test(sheetXml) ||
      !/<pageSetup\b[^>]*\borientation="portrait"/.test(sheetXml) ||
      !relationships.includes('Target="worksheets/sheet1.xml"') ||
      zip.FullPaths.some(path => /(?:vbaProject|externalLinks|embeddings|activeX)/i.test(path))) {
    throw Error('ต้นแบบต้องใช้ใบนับ A4 แนวตั้งตามแบบที่อนุมัติ');
  }
}

function setCounts(sheet, rows) {
  const visited = new Set();
  const next = sheet.replace(/<row\b[^>]*\br="(\d+)"[^>]*>[^]*?<\/row>/g, (xml, number) => {
    const values = rows.get(Number(number));
    if (!values) return xml;
    visited.add(Number(number));
    const visible = xml.replace(/^<row\b[^>]*>/, tag => tag.replace(/\s+hidden="[^"]*"/, ''));
    return inputColumns.reduce((current, column, index) => {
      if (values[index] == null) return current;
      const cell = new RegExp('<c\\b([^>]*\\br="' + column + number + '"[^>]*?)(?:\\/>|>[^]*?<\\/c>)');
      if (!cell.test(current)) throw Error(`ช่องผลนับหาย ${column}${number}`);
      return current.replace(cell, (_match, attributes) =>
        `<c${attributes.replace(/\s+t="[^"]*"/g, '')}><v>${values[index] / 1000}</v></c>`,
      );
    }, visible);
  });
  if (visited.size !== rows.size) throw Error('จำนวนแถวที่กรอกไม่ตรงกับต้นแบบ');
  return next;
}

function extrasSheet(rows) {
  const escaped = text => String(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const table = [['หน้า A4', 'รหัส', 'ชื่อสินค้า', 'BARCODE', 'หน่วย', 'จุดนับ', 'ตำแหน่ง', 'จำนวน'], ...rows];
  const data = table.map((row, index) => {
    const number = index + 1;
    const cells = row.map((value, col) => {
      const ref = 'ABCDEFGH'[col] + number;
      return typeof value === 'number'
        ? `<c r="${ref}"><v>${value}</v></c>`
        : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escaped(value)}</t></is></c>`;
    }).join('');
    return `<row r="${number}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${xmlNamespace}"><dimension ref="A1:H${table.length}"/><sheetData>${data}</sheetData></worksheet>`;
}

function generateWorkbook(source, pages) {
  const bytes = Buffer.from(source.base64, 'base64');
  if (sha256(bytes) !== source.sha256) throw Error('ต้นแบบ Excel ไม่ตรงกับที่ตรึงไว้');
  const zip = XLSX.CFB.read(bytes, { type: 'buffer' });
  const rows = new Map(), extras = [];
  for (const page of pages) {
    for (const item of page.items) {
      const points = page.counts[String(item.row)];
      if (!Array.isArray(points) || rows.has(item.row)) throw Error('ผลนับไม่ครบหรือซ้ำ');
      const total = points.reduce((sum, point) => sum + (point?.quantityMilli ?? 0), 0);
      rows.set(item.row, [total, ...points.slice(0, 3).map(point => point?.quantityMilli)]);
      points.slice(3).forEach((point, index) => extras.push(
        [page.page_no, item.code, item.name, item.barcode, item.unit, index + 4, point.place, point.quantityMilli / 1000],
      ));
    }
  }
  const sheetPath = '/xl/worksheets/sheet1.xml';
  updatePart(zip, sheetPath, clearFilterCriteria(setCounts(xmlPart(zip, sheetPath), rows)));
  for (const part of zip.FullPaths.filter(path => /\/xl\/tables\/[^/]+\.xml$/.test(path))) {
    updatePart(zip, part, clearFilterCriteria(xmlPart(zip, part)));
  }
  if (extras.length) {
    const workbook = '/xl/workbook.xml';
    const rels = '/xl/_rels/workbook.xml.rels';
    const types = '/[Content_Types].xml';
    updatePart(zip, workbook, addXml(xmlPart(zip, workbook), '</sheets>',
      '<sheet name="จุดนับเพิ่มเติม" sheetId="2" r:id="rIdScpdaExtras"/>'));
    updatePart(zip, rels, addXml(xmlPart(zip, rels), '</Relationships>',
      `<Relationship Id="rIdScpdaExtras" Type="${worksheetRel}" Target="worksheets/scpda-extra.xml"/>`));
    updatePart(zip, types, addXml(xmlPart(zip, types), '</Types>',
      `<Override PartName="${extrasPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`));
    XLSX.CFB.utils.cfb_add(zip, extrasPath.slice(1), Buffer.from(extrasSheet(extras)));
  }
  return { filename: source.filename, base64: XLSX.CFB.write(zip, { type: 'buffer', fileType: 'zip', compression: true }).toString('base64') };
}

module.exports = { generateWorkbook, sha256, validateTemplate };
