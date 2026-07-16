from __future__ import annotations

import csv
import datetime as dt
import html
import io
import json
import mimetypes
import os
import posixpath
import re
import sys
import textwrap
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parent
STATIC_ROOT = ROOT / "static"
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_ROWS = 50000

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
}


def json_response(handler: BaseHTTPRequestHandler, payload: dict, status: int = 200) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def read_upload(handler: BaseHTTPRequestHandler) -> tuple[str, bytes]:
    content_length = int(handler.headers.get("Content-Length", "0") or "0")
    if content_length <= 0:
        raise ValueError("No file was uploaded.")
    if content_length > MAX_UPLOAD_BYTES:
        raise ValueError("The upload is larger than the 25 MB limit.")

    content_type = handler.headers.get("Content-Type", "")
    boundary_match = re.search(r"boundary=(?P<boundary>[^;]+)", content_type)
    if not boundary_match:
        raise ValueError("Expected a multipart file upload.")

    boundary = boundary_match.group("boundary").strip('"').encode("utf-8")
    body = handler.rfile.read(content_length)
    delimiter = b"--" + boundary

    for raw_part in body.split(delimiter):
        part = raw_part.strip(b"\r\n")
        if not part or part == b"--":
            continue
        if b"\r\n\r\n" not in part:
            continue
        header_bytes, file_bytes = part.split(b"\r\n\r\n", 1)
        headers = header_bytes.decode("utf-8", errors="replace")
        disposition = next(
            (line for line in headers.splitlines() if line.lower().startswith("content-disposition:")),
            "",
        )
        name_match = re.search(r'name="?([^";]+)"?', disposition)
        if not name_match or name_match.group(1) != "file":
            continue
        filename_match = re.search(r'filename="?(?P<name>[^";]*)"?', disposition)
        filename = filename_match.group("name") if filename_match else "uploaded-file"
        filename = os.path.basename(filename) or "uploaded-file"
        if file_bytes.endswith(b"\r\n"):
            file_bytes = file_bytes[:-2]
        return filename, file_bytes

    raise ValueError("Could not find a file field named 'file'.")


def decode_text(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-16", "cp1252", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def normalize_header(value: str) -> str:
    value = re.sub(r"\s+", " ", str(value or "").strip())
    return value or "Column"


def unique_headers(headers: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    result: list[str] = []
    for index, header in enumerate(headers, start=1):
        base = normalize_header(header) or f"Column {index}"
        count = seen.get(base, 0)
        seen[base] = count + 1
        result.append(base if count == 0 else f"{base} ({count + 1})")
    return result


def clean_record(record: dict[str, object]) -> dict[str, str]:
    cleaned: dict[str, str] = {}
    for key, value in record.items():
        text = "" if value is None else str(value).strip()
        cleaned[normalize_header(key)] = text
    return cleaned


def parse_csv_file(data: bytes) -> tuple[list[str], list[dict[str, str]], str | None]:
    text = decode_text(data)
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",\t;|")
    except csv.Error:
        dialect = csv.excel

    reader = csv.reader(io.StringIO(text), dialect)
    all_rows = [[cell.strip() for cell in row] for row in reader]
    all_rows = [row for row in all_rows if any(cell for cell in row)]
    if not all_rows:
        raise ValueError("The file did not contain any rows.")

    header_index = find_header_row(all_rows)
    headers = unique_headers(all_rows[header_index])
    records: list[dict[str, str]] = []
    for row in all_rows[header_index + 1 : header_index + 1 + MAX_ROWS]:
        padded = row + [""] * max(0, len(headers) - len(row))
        records.append(clean_record(dict(zip(headers, padded[: len(headers)]))))

    return headers, records, None


def find_header_row(rows: list[list[str]]) -> int:
    best_index = 0
    best_score = -1
    for index, row in enumerate(rows[:25]):
        non_empty = [cell for cell in row if str(cell).strip()]
        alpha_cells = [cell for cell in non_empty if re.search(r"[A-Za-z]", str(cell))]
        score = len(non_empty) + len(alpha_cells)
        if len(non_empty) >= 2 and score > best_score:
            best_index = index
            best_score = score
    return best_index


def score_sheet(sheet_name: str, headers: list[str], records: list[dict[str, str]]) -> int:
    header_text = " ".join(headers).lower()
    jira_terms = [
        "key",
        "summary",
        "assignment group",
        "planned start date",
        "planned end date",
        "change start date",
        "change completion date",
        "status",
    ]
    score = len(records) + len(headers)
    score += sum(100 for term in jira_terms if term in header_text)
    if sheet_name.strip().lower() in {"about", "metadata", "info"}:
        score -= 1000
    return score


def parse_xlsx_file(data: bytes) -> tuple[list[str], list[dict[str, str]], str | None]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        shared_strings = read_shared_strings(archive)
        date1904 = workbook_uses_1904_dates(archive)
        date_styles = read_date_style_indexes(archive)
        sheets = workbook_sheets(archive)
        if not sheets:
            raise ValueError("The workbook did not contain any sheets.")

        best: tuple[int, list[str], list[dict[str, str]], str | None] | None = None
        for sheet_name, sheet_path in sheets:
            rows = worksheet_rows(archive, sheet_path, shared_strings, date_styles, date1904)
            rows = [row for row in rows if any(cell for cell in row)]
            if not rows:
                continue
            header_index = find_header_row(rows)
            headers = unique_headers(rows[header_index])
            records: list[dict[str, str]] = []
            for row in rows[header_index + 1 : header_index + 1 + MAX_ROWS]:
                padded = row + [""] * max(0, len(headers) - len(row))
                record = clean_record(dict(zip(headers, padded[: len(headers)])))
                if any(record.values()):
                    records.append(record)
            if records:
                candidate_score = score_sheet(sheet_name, headers, records)
                if best is None or candidate_score > best[0]:
                    best = (candidate_score, headers, records, sheet_name)

        if best is None:
            raise ValueError("No data rows were found in the workbook.")
        return best[1], best[2], best[3]


def read_xml(archive: zipfile.ZipFile, path: str) -> ET.Element:
    return ET.fromstring(archive.read(path))


def ns(tag: str) -> str:
    return f"{{http://schemas.openxmlformats.org/spreadsheetml/2006/main}}{tag}"


def rel_ns(tag: str) -> str:
    return f"{{http://schemas.openxmlformats.org/officeDocument/2006/relationships}}{tag}"


def package_rel_ns(tag: str) -> str:
    return f"{{http://schemas.openxmlformats.org/package/2006/relationships}}{tag}"


def read_shared_strings(archive: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = read_xml(archive, "xl/sharedStrings.xml")
    strings: list[str] = []
    for item in root.findall(ns("si")):
        texts = [text_node.text or "" for text_node in item.iter(ns("t"))]
        strings.append("".join(texts))
    return strings


def workbook_uses_1904_dates(archive: zipfile.ZipFile) -> bool:
    root = read_xml(archive, "xl/workbook.xml")
    workbook_pr = root.find(ns("workbookPr"))
    return workbook_pr is not None and workbook_pr.attrib.get("date1904") in {"1", "true", "True"}


def workbook_sheets(archive: zipfile.ZipFile) -> list[tuple[str, str]]:
    workbook = read_xml(archive, "xl/workbook.xml")
    relationships = read_xml(archive, "xl/_rels/workbook.xml.rels")
    rels: dict[str, str] = {}
    for rel in relationships.findall(package_rel_ns("Relationship")):
        target = rel.attrib.get("Target", "")
        target = target.lstrip("/")
        rels[rel.attrib.get("Id", "")] = target if target.startswith("xl/") else f"xl/{target}"

    result: list[tuple[str, str]] = []
    sheets_node = workbook.find(ns("sheets"))
    if sheets_node is None:
        return result
    for sheet in sheets_node.findall(ns("sheet")):
        sheet_name = html.unescape(sheet.attrib.get("name", "Sheet"))
        relationship_id = sheet.attrib.get(rel_ns("id"), "")
        sheet_path = rels.get(relationship_id)
        if sheet_path and sheet_path in archive.namelist():
            result.append((sheet_name, sheet_path))
    return result


def read_date_style_indexes(archive: zipfile.ZipFile) -> set[int]:
    if "xl/styles.xml" not in archive.namelist():
        return set()
    root = read_xml(archive, "xl/styles.xml")
    custom_formats: dict[int, str] = {}
    num_fmts = root.find(ns("numFmts"))
    if num_fmts is not None:
        for num_fmt in num_fmts.findall(ns("numFmt")):
            try:
                custom_formats[int(num_fmt.attrib.get("numFmtId", ""))] = num_fmt.attrib.get("formatCode", "")
            except ValueError:
                continue

    built_in_date_ids = {
        14,
        15,
        16,
        17,
        18,
        19,
        20,
        21,
        22,
        27,
        30,
        36,
        45,
        46,
        47,
        50,
        57,
    }
    date_styles: set[int] = set()
    cell_xfs = root.find(ns("cellXfs"))
    if cell_xfs is None:
        return date_styles

    for index, xf in enumerate(cell_xfs.findall(ns("xf"))):
        try:
            num_fmt_id = int(xf.attrib.get("numFmtId", "0"))
        except ValueError:
            continue
        custom_format = custom_formats.get(num_fmt_id, "")
        if num_fmt_id in built_in_date_ids or looks_like_excel_date_format(custom_format):
            date_styles.add(index)
    return date_styles


def looks_like_excel_date_format(format_code: str) -> bool:
    if not format_code:
        return False
    stripped = re.sub(r'"[^"]*"', "", format_code)
    stripped = re.sub(r"\[[^\]]+\]", "", stripped)
    return bool(re.search(r"(?<![A-Za-z])[ymdhHsS]+(?![A-Za-z])", stripped))


def worksheet_rows(
    archive: zipfile.ZipFile,
    path: str,
    shared_strings: list[str],
    date_styles: set[int],
    date1904: bool,
) -> list[list[str]]:
    root = read_xml(archive, path)
    sheet_data = root.find(ns("sheetData"))
    if sheet_data is None:
        return []

    rows: list[list[str]] = []
    for row_node in sheet_data.findall(ns("row")):
        cells: dict[int, str] = {}
        for cell_node in row_node.findall(ns("c")):
            ref = cell_node.attrib.get("r", "")
            column_index = column_ref_to_index(ref)
            if column_index is None:
                column_index = len(cells)
            cells[column_index] = read_cell_value(cell_node, shared_strings, date_styles, date1904)
        if cells:
            width = max(cells.keys()) + 1
            rows.append([cells.get(i, "") for i in range(width)])
    return rows


def column_ref_to_index(ref: str) -> int | None:
    match = re.match(r"([A-Z]+)", ref.upper())
    if not match:
        return None
    value = 0
    for char in match.group(1):
        value = value * 26 + (ord(char) - ord("A") + 1)
    return value - 1


def read_cell_value(
    cell_node: ET.Element,
    shared_strings: list[str],
    date_styles: set[int],
    date1904: bool,
) -> str:
    cell_type = cell_node.attrib.get("t", "")
    style_index = int(cell_node.attrib.get("s", "0") or "0")

    if cell_type == "inlineStr":
        texts = [text_node.text or "" for text_node in cell_node.iter(ns("t"))]
        return "".join(texts).strip()

    value_node = cell_node.find(ns("v"))
    if value_node is None or value_node.text is None:
        return ""
    raw = value_node.text.strip()

    if cell_type == "s":
        try:
            return shared_strings[int(raw)].strip()
        except (ValueError, IndexError):
            return raw
    if cell_type == "b":
        return "TRUE" if raw == "1" else "FALSE"
    if style_index in date_styles:
        converted = excel_serial_to_date(raw, date1904)
        if converted:
            return converted
    return raw


def excel_serial_to_date(raw: str, date1904: bool) -> str | None:
    try:
        serial = float(raw)
    except ValueError:
        return None
    if serial <= 0:
        return None
    epoch = dt.datetime(1904, 1, 1) if date1904 else dt.datetime(1899, 12, 30)
    converted = epoch + dt.timedelta(days=serial)
    if abs(converted.hour + converted.minute + converted.second) == 0:
        return converted.date().isoformat()
    return converted.isoformat(timespec="minutes")


def parse_uploaded_file(filename: str, data: bytes) -> dict:
    suffix = Path(filename).suffix.lower()
    if suffix in {".xlsx", ".xlsm"}:
        columns, rows, sheet_name = parse_xlsx_file(data)
    elif suffix in {".csv", ".tsv", ".txt"}:
        columns, rows, sheet_name = parse_csv_file(data)
    else:
        raise ValueError("Please upload a CSV, TSV, TXT, XLSX, or XLSM file.")

    return {
        "fileName": filename,
        "sheetName": sheet_name,
        "columns": columns,
        "rows": rows,
        "rowCount": len(rows),
        "maxRows": MAX_ROWS,
        "truncated": len(rows) >= MAX_ROWS,
    }


def read_json_body(handler: BaseHTTPRequestHandler) -> dict:
    content_length = int(handler.headers.get("Content-Length", "0") or "0")
    if content_length <= 0:
        raise ValueError("No report data was provided.")
    if content_length > 1024 * 1024:
        raise ValueError("The report payload is too large.")
    return json.loads(handler.rfile.read(content_length).decode("utf-8"))


def pdf_text(value: object) -> str:
    text = str(value or "")
    text = (
        text.replace("\u2013", "-")
        .replace("\u2014", "-")
        .replace("\u2018", "'")
        .replace("\u2019", "'")
        .replace("\u201c", '"')
        .replace("\u201d", '"')
    )
    text = text.encode("latin-1", errors="replace").decode("latin-1")
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def pdf_number(value: object, default: float = 0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def rgb(color: tuple[int, int, int]) -> str:
    return " ".join(f"{part / 255:.3f}" for part in color)


def pdf_rect(commands: list[str], x: float, y: float, width: float, height: float, fill: tuple[int, int, int] | None = None, stroke: tuple[int, int, int] | None = None) -> None:
    commands.append("q")
    if fill:
        commands.append(f"{rgb(fill)} rg")
    if stroke:
        commands.append(f"{rgb(stroke)} RG 0.8 w")
    commands.append(f"{x:.1f} {y:.1f} {width:.1f} {height:.1f} re")
    if fill and stroke:
        commands.append("B")
    elif fill:
        commands.append("f")
    else:
        commands.append("S")
    commands.append("Q")


def pdf_line(commands: list[str], x1: float, y1: float, x2: float, y2: float, color: tuple[int, int, int]) -> None:
    commands.append("q")
    commands.append(f"{rgb(color)} RG 1.2 w")
    commands.append(f"{x1:.1f} {y1:.1f} m {x2:.1f} {y2:.1f} l S")
    commands.append("Q")


def pdf_draw_text(commands: list[str], x: float, y: float, text: object, size: int = 10, bold: bool = False, color: tuple[int, int, int] = (24, 33, 47)) -> None:
    font = "F2" if bold else "F1"
    commands.append("BT")
    commands.append(f"{rgb(color)} rg")
    commands.append(f"/{font} {size} Tf")
    commands.append(f"{x:.1f} {y:.1f} Td")
    commands.append(f"({pdf_text(text)}) Tj")
    commands.append("ET")


def pdf_panel(commands: list[str], x: float, y: float, width: float, height: float, title: str) -> None:
    pdf_rect(commands, x, y, width, height, fill=(255, 255, 255), stroke=(216, 222, 232))
    pdf_draw_text(commands, x + 12, y + height - 20, title, size=11, bold=True)


def pdf_bar_rows(commands: list[str], rows: list[dict], label_key: str, value_key: str, x: float, y: float, width: float, height: float, color: tuple[int, int, int]) -> None:
    rows = rows[:6]
    if not rows:
        pdf_draw_text(commands, x + 12, y + height - 46, "No data available", size=9, color=(100, 112, 132))
        return
    max_value = max(1, *(pdf_number(row.get(value_key)) for row in rows))
    row_y = y + height - 48
    label_width = 78 if width < 260 else 96
    bar_width = width - label_width - 70
    for row in rows:
        label = str(row.get(label_key) or "Unspecified")[:18 if width < 260 else 24]
        value = pdf_number(row.get(value_key))
        rate = pdf_number(row.get("rate"))
        bar = bar_width * value / max_value
        pdf_draw_text(commands, x + 12, row_y + 3, label, size=8, color=(53, 64, 82))
        pdf_rect(commands, x + 12 + label_width, row_y, bar_width, 9, fill=(237, 241, 246))
        pdf_rect(commands, x + 12 + label_width, row_y, max(1, bar), 9, fill=color)
        pdf_draw_text(commands, x + width - 54, row_y + 2, f"{int(value)} ({rate:.0%})", size=8, bold=True, color=color)
        row_y -= 17


def pdf_rate_rows(commands: list[str], rows: list[dict], x: float, y: float, width: float, height: float, color: tuple[int, int, int]) -> None:
    rows = rows[:6]
    if not rows:
        pdf_draw_text(commands, x + 12, y + height - 46, "No completed planned changes", size=9, color=(100, 112, 132))
        return
    row_y = y + height - 48
    label_width = 78 if width < 260 else 96
    bar_width = width - label_width - 70
    for row in rows:
        label = str(row.get("label") or "Unassigned")[:18 if width < 260 else 24]
        rate = max(0, min(1, pdf_number(row.get("rate"))))
        eligible = int(pdf_number(row.get("eligible")))
        pdf_draw_text(commands, x + 12, row_y + 3, label, size=8, color=(53, 64, 82))
        pdf_rect(commands, x + 12 + label_width, row_y, bar_width, 9, fill=(237, 241, 246))
        pdf_rect(commands, x + 12 + label_width, row_y, max(1, bar_width * rate), 9, fill=color)
        pdf_draw_text(commands, x + width - 54, row_y + 2, f"{rate:.0%} ({eligible})", size=8, bold=True, color=color)
        row_y -= 17


def pdf_team_rows(commands: list[str], rows: list[dict], x: float, y: float, width: float, height: float) -> None:
    rows = rows[:5]
    if not rows:
        pdf_draw_text(commands, x + 12, y + height - 46, "No team data available", size=9, color=(100, 112, 132))
        return
    max_team_total = max(1, *(pdf_number(team.get("total")) for team in rows))
    row_y = y + height - 48
    label_width = 102
    value_width = 112
    bar_width = width - label_width - value_width - 28
    for team in rows:
        label = str(team.get("label") or "Unassigned")[:24]
        total = pdf_number(team.get("total"))
        outside = int(pdf_number(team.get("outsideTimeline")))
        on_time = pdf_number(team.get("onTimeRate"))
        pdf_draw_text(commands, x + 12, row_y + 3, label, size=8)
        pdf_rect(commands, x + 12 + label_width, row_y, bar_width, 9, fill=(237, 241, 246))
        pdf_rect(commands, x + 12 + label_width, row_y, max(1, bar_width * total / max_team_total), 9, fill=(47, 111, 237))
        pdf_draw_text(commands, x + width - value_width + 8, row_y + 2, f"{int(total)} total | {outside} risk | {on_time:.0%}", size=8, color=(100, 112, 132))
        row_y -= 17


def build_pdf(objects: list[bytes]) -> bytes:
    result = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(result))
        result.extend(f"{index} 0 obj\n".encode("latin-1"))
        result.extend(obj)
        result.extend(b"\nendobj\n")
    xref_offset = len(result)
    result.extend(f"xref\n0 {len(objects) + 1}\n".encode("latin-1"))
    result.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        result.extend(f"{offset:010d} 00000 n \n".encode("latin-1"))
    result.extend(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("latin-1"))
    return bytes(result)


def generate_executive_pdf(payload: dict) -> bytes:
    width, height = 792, 612
    commands: list[str] = []
    file_name = payload.get("fileName", "Jira export")
    sheet_name = payload.get("sheetName", "")
    timeline = payload.get("timelineLabel") or "Timeline unavailable"
    generated = payload.get("generatedAt") or dt.datetime.now().strftime("%Y-%m-%d %H:%M")
    kpis = payload.get("kpis", {})
    change_types = payload.get("changeTypes", [])
    statuses = payload.get("statuses", [])
    top_teams = payload.get("topTeams", [])
    on_time_teams = payload.get("onTimeTeams", [])
    findings = payload.get("findings", [])

    pdf_rect(commands, 0, 0, width, height, fill=(246, 247, 249))
    pdf_draw_text(commands, 36, 562, "Jira Change Executive Summary", size=22, bold=True)
    pdf_draw_text(commands, 36, 544, f"{file_name}  |  {sheet_name}", size=9, color=(100, 112, 132))
    pdf_draw_text(commands, 36, 530, f"Timeline: {timeline}  |  Generated: {generated}", size=9, color=(100, 112, 132))

    cards = [
        ("Total Changes", f"{int(pdf_number(kpis.get('total'))):,}", (47, 111, 237)),
        ("Completed", f"{int(pdf_number(kpis.get('completed'))):,} ({pdf_number(kpis.get('completedRate')):.0%})", (22, 135, 95)),
        (
            "Finished On Time",
            f"{int(pdf_number(kpis.get('onTimeCompleted'))):,} ({pdf_number(kpis.get('onTimeRate')):.0%})",
            (111, 82, 181),
        ),
        (
            "Outside Timeline",
            f"{int(pdf_number(kpis.get('outsideTimeline'))):,} ({pdf_number(kpis.get('outsideTimelineRate')):.0%})",
            (194, 65, 59),
        ),
    ]
    card_width = 171
    for index, (label, value, color) in enumerate(cards):
        x = 36 + index * (card_width + 12)
        pdf_rect(commands, x, 446, card_width, 62, fill=(255, 255, 255), stroke=(216, 222, 232))
        pdf_rect(commands, x, 506, card_width, 3, fill=color)
        pdf_draw_text(commands, x + 12, 486, label, size=9, bold=True, color=(100, 112, 132))
        pdf_draw_text(commands, x + 12, 462, value, size=18, bold=True, color=color)

    left_x, right_x = 36, 414
    panel_width = 342
    panel_height = 138

    pdf_panel(commands, left_x, 304, panel_width, panel_height, "Change Type Mix")
    pdf_bar_rows(commands, change_types, "label", "total", left_x, 304, panel_width, panel_height, (47, 111, 237))

    pdf_panel(commands, right_x, 304, panel_width, panel_height, "Status Mix")
    pdf_bar_rows(commands, statuses, "label", "total", right_x, 304, panel_width, panel_height, (22, 135, 95))

    pdf_panel(commands, left_x, 146, panel_width, panel_height, "On-Time Finish Rate")
    pdf_rate_rows(commands, on_time_teams, left_x, 146, panel_width, panel_height, (111, 82, 181))

    pdf_panel(commands, right_x, 146, panel_width, panel_height, "Top Teams by Volume")
    pdf_team_rows(commands, top_teams, right_x, 146, panel_width, panel_height)

    pdf_panel(commands, 36, 56, 720, 68, "Executive Readout")
    y = 98
    for finding in findings[:3]:
        for line in textwrap.wrap(str(finding), width=142)[:1]:
            pdf_draw_text(commands, 48, y, line, size=8, color=(53, 64, 82))
            y -= 13
    pdf_draw_text(commands, 48, 68, "High-level overview only. Use the dashboard drilldowns for operational detail.", size=8, color=(100, 112, 132))

    stream = "\n".join(commands).encode("latin-1", errors="replace")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>".encode("latin-1"),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
        b"<< /Length " + str(len(stream)).encode("latin-1") + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    return build_pdf(objects)


def pdf_response(handler: BaseHTTPRequestHandler, pdf: bytes, filename: str) -> None:
    handler.send_response(200)
    handler.send_header("Content-Type", "application/pdf")
    handler.send_header("Content-Disposition", f'attachment; filename="{filename}"')
    handler.send_header("Content-Length", str(len(pdf)))
    handler.end_headers()
    handler.wfile.write(pdf)


PPTX_INCH = 914400
PPTX_SLIDE_CX = 12192000
PPTX_SLIDE_CY = 6858000
PPTX_SLIDE_WIDTH = 13.333333
PPTX_SLIDE_HEIGHT = 7.5
PPTX_TEMPLATE_PATH = ROOT / "pptx_template.pptx"


def pptx_escape(value: object) -> str:
    return html.escape(str(value or ""), quote=True)


def pptx_emu(value: float) -> int:
    return int(round(value * PPTX_INCH))


def pptx_percent(value: object) -> str:
    return f"{pdf_number(value):.0%}"


def pptx_integer(value: object) -> str:
    return f"{int(round(pdf_number(value))):,}"


def pptx_truncate(value: object, limit: int) -> str:
    text = str(value or "")
    return text if len(text) <= limit else f"{text[: max(0, limit - 3)]}..."


class PptSlide:
    def __init__(self) -> None:
        self.shapes: list[str] = []
        self.shape_id = 2

    def next_shape_id(self) -> int:
        shape_id = self.shape_id
        self.shape_id += 1
        return shape_id

    def rect(self, x: float, y: float, width: float, height: float, fill: str | None, line: str | None = None) -> None:
        shape_id = self.next_shape_id()
        fill_xml = f'<a:solidFill><a:srgbClr val="{fill}"/></a:solidFill>' if fill else "<a:noFill/>"
        line_xml = f'<a:ln w="9525"><a:solidFill><a:srgbClr val="{line}"/></a:solidFill></a:ln>' if line else "<a:ln><a:noFill/></a:ln>"
        self.shapes.append(
            f"""
            <p:sp>
              <p:nvSpPr>
                <p:cNvPr id="{shape_id}" name="Rectangle {shape_id}"/>
                <p:cNvSpPr/>
                <p:nvPr/>
              </p:nvSpPr>
              <p:spPr>
                <a:xfrm>
                  <a:off x="{pptx_emu(x)}" y="{pptx_emu(y)}"/>
                  <a:ext cx="{pptx_emu(width)}" cy="{pptx_emu(height)}"/>
                </a:xfrm>
                <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                {fill_xml}
                {line_xml}
              </p:spPr>
            </p:sp>
            """
        )

    def text(
        self,
        x: float,
        y: float,
        width: float,
        height: float,
        text: object,
        size: int = 10,
        bold: bool = False,
        color: str = "18212F",
        align: str = "l",
    ) -> None:
        shape_id = self.next_shape_id()
        bold_attr = ' b="1"' if bold else ""
        paragraphs = []
        lines = str(text or "").splitlines() or [""]
        for line in lines:
            paragraphs.append(
                f"""
                <a:p>
                  <a:pPr algn="{align}"/>
                  <a:r>
                    <a:rPr lang="en-US" sz="{size * 100}"{bold_attr}>
                      <a:solidFill><a:srgbClr val="{color}"/></a:solidFill>
                    </a:rPr>
                    <a:t>{pptx_escape(line)}</a:t>
                  </a:r>
                  <a:endParaRPr lang="en-US" sz="{size * 100}"/>
                </a:p>
                """
            )
        self.shapes.append(
            f"""
            <p:sp>
              <p:nvSpPr>
                <p:cNvPr id="{shape_id}" name="Text {shape_id}"/>
                <p:cNvSpPr txBox="1"/>
                <p:nvPr/>
              </p:nvSpPr>
              <p:spPr>
                <a:xfrm>
                  <a:off x="{pptx_emu(x)}" y="{pptx_emu(y)}"/>
                  <a:ext cx="{pptx_emu(width)}" cy="{pptx_emu(height)}"/>
                </a:xfrm>
                <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                <a:noFill/>
                <a:ln><a:noFill/></a:ln>
              </p:spPr>
              <p:txBody>
                <a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"/>
                <a:lstStyle/>
                {''.join(paragraphs)}
              </p:txBody>
            </p:sp>
            """
        )

    def xml(self) -> str:
        return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
      {''.join(self.shapes)}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>"""


def pptx_add_background(slide: PptSlide) -> None:
    slide.rect(0, 0, PPTX_SLIDE_WIDTH, PPTX_SLIDE_HEIGHT, "F6F8FB")


def pptx_add_header(slide: PptSlide, title: str, payload: dict, subtitle: str | None = None) -> None:
    timeline = payload.get("timelineLabel") or "Timeline unavailable"
    generated = payload.get("generatedAt") or dt.datetime.now().strftime("%Y-%m-%d %H:%M")
    subtitle_text = subtitle or f"Timeline: {timeline} | Generated: {generated}"
    slide.text(0.55, 0.34, 8.6, 0.42, title, size=22, bold=True)
    slide.text(0.57, 0.82, 9.6, 0.22, subtitle_text, size=8, color="647084")
    slide.text(10.4, 0.38, 2.35, 0.22, "Executive PowerPoint", size=8, color="647084", align="r")
    slide.rect(0.55, 1.07, 12.25, 0.02, "D8DEE8")


def pptx_add_kpi_card(slide: PptSlide, x: float, label: str, value: str, color: str) -> None:
    slide.rect(x, 1.25, 2.85, 0.98, "FFFFFF", "D8DEE8")
    slide.rect(x, 1.25, 2.85, 0.06, color)
    slide.text(x + 0.16, 1.44, 2.5, 0.18, label, size=8, bold=True, color="647084")
    slide.text(x + 0.16, 1.68, 2.55, 0.34, value, size=20, bold=True, color=color)


def pptx_add_overview_gauge(slide: PptSlide, x: float, y: float, label: str, rate: float, color: str) -> None:
    rate = max(0.0, min(1.0, rate))
    slide.text(x, y, 3.8, 0.22, label, size=10, bold=True)
    slide.text(x + 4.2, y, 1.0, 0.22, f"{rate:.0%}", size=10, bold=True, color=color, align="r")
    slide.rect(x, y + 0.38, 5.2, 0.16, "EAF0F7")
    if rate > 0:
        slide.rect(x, y + 0.38, max(0.03, 5.2 * rate), 0.16, color)


def pptx_overview_slide(payload: dict) -> PptSlide:
    slide = PptSlide()
    pptx_add_background(slide)
    pptx_add_header(slide, "Jira Change Executive Summary", payload)
    file_name = pptx_truncate(payload.get("fileName") or "Jira export", 86)
    sheet_name = payload.get("sheetName") or ""
    file_line = f"{file_name} | {sheet_name}" if sheet_name else file_name
    slide.text(0.57, 1.00, 9.8, 0.2, file_line, size=7, color="647084")

    kpis = payload.get("kpis", {})
    total = pdf_number(kpis.get("total"))
    completed = pdf_number(kpis.get("completed"))
    completed_rate = pdf_number(kpis.get("completedRate"))
    on_time_count = pdf_number(kpis.get("onTimeCompleted"))
    on_time_rate = pdf_number(kpis.get("onTimeRate"))
    outside = pdf_number(kpis.get("outsideTimeline"))
    outside_rate = pdf_number(kpis.get("outsideTimelineRate"), outside / total if total else 0)
    open_past_plan = pdf_number(kpis.get("openPastPlan"))

    cards = [
        ("Total Changes", pptx_integer(total), "2F6FED"),
        ("Completed", f"{pptx_integer(completed)} ({completed_rate:.0%})", "16875F"),
        ("Finished On Time", f"{pptx_integer(on_time_count)} ({on_time_rate:.0%})", "6F52B5"),
        ("Outside Timeline", f"{pptx_integer(outside)} ({outside_rate:.0%})", "C2413B"),
    ]
    for index, (label, value, color) in enumerate(cards):
        pptx_add_kpi_card(slide, 0.55 + index * 3.05, label, value, color)

    slide.rect(0.55, 2.62, 5.95, 3.65, "FFFFFF", "D8DEE8")
    slide.text(0.82, 2.88, 5.3, 0.26, "Executive Readout", size=14, bold=True)
    y = 3.28
    findings = [str(item) for item in payload.get("findings", []) if str(item).strip()]
    if not findings:
        findings = ["No executive findings were available from the current file."]
    for finding in findings[:4]:
        wrapped = textwrap.wrap(finding, width=82)[:2]
        slide.text(0.86, y, 5.2, 0.42, "- " + "\n  ".join(wrapped), size=9, color="354052")
        y += 0.62
    slide.text(0.86, 5.78, 5.2, 0.24, "Operational details remain in dashboard drilldowns.", size=8, color="647084")

    slide.rect(6.85, 2.62, 5.95, 3.65, "FFFFFF", "D8DEE8")
    slide.text(7.12, 2.88, 5.3, 0.26, "Situation Snapshot", size=14, bold=True)
    pptx_add_overview_gauge(slide, 7.12, 3.35, "Completion rate", completed_rate, "16875F")
    pptx_add_overview_gauge(slide, 7.12, 4.15, "On-time finish rate", on_time_rate, "6F52B5")
    pptx_add_overview_gauge(slide, 7.12, 4.95, "Outside timeline rate", outside_rate, "C2413B")
    slide.text(7.12, 5.78, 5.1, 0.24, f"Open past plan: {pptx_integer(open_past_plan)}", size=9, bold=True, color="C2413B")
    return slide


def pptx_timeline_rows(payload: dict, rows: list[dict], rows_per_slide: int = 12) -> list[PptSlide]:
    title = "Planned End vs Completed Timeline"
    if not rows:
        slide = PptSlide()
        pptx_add_background(slide)
        pptx_add_header(slide, title, payload, "No timeline rows available")
        slide.rect(0.8, 1.55, 11.75, 4.9, "FFFFFF", "D8DEE8")
        slide.text(1.05, 3.65, 11.15, 0.36, "No planned or completed dates were found.", size=14, bold=True, color="647084", align="ctr")
        return [slide]

    slides: list[PptSlide] = []
    chunks = [rows[index : index + rows_per_slide] for index in range(0, len(rows), rows_per_slide)]
    for page_index, chunk in enumerate(chunks):
        slide = PptSlide()
        pptx_add_background(slide)
        start = page_index * rows_per_slide + 1
        end = start + len(chunk) - 1
        suffix = f" ({page_index + 1}/{len(chunks)})" if len(chunks) > 1 else ""
        pptx_add_header(slide, f"{title}{suffix}", payload, f"Rows {start}-{end} of {len(rows)} | All rows included")
        slide.rect(0.6, 1.32, 12.2, 5.55, "FFFFFF", "D8DEE8")
        slide.rect(8.9, 1.50, 0.16, 0.16, "2F6FED")
        slide.text(9.12, 1.47, 1.0, 0.2, "Planned", size=8, color="647084")
        slide.rect(10.2, 1.50, 0.16, 0.16, "16875F")
        slide.text(10.42, 1.47, 1.1, 0.2, "Completed", size=8, color="647084")

        max_value = max(
            1.0,
            *(max(pdf_number(row.get("planned")), pdf_number(row.get("completed"))) for row in chunk),
        )
        label_x = 0.86
        label_w = 2.55
        bar_x = 3.62
        bar_w = 6.72
        value_x = 10.58
        y = 1.84
        row_h = 0.42
        for row in chunk:
            label = pptx_truncate(row.get("label") or "Timeline", 34)
            planned = pdf_number(row.get("planned"))
            completed = pdf_number(row.get("completed"))
            slide.text(label_x, y + 0.07, label_w, 0.22, label, size=8, color="354052", align="r")
            slide.rect(bar_x, y, bar_w, 0.13, "EAF0F7")
            slide.rect(bar_x, y + 0.18, bar_w, 0.13, "EAF0F7")
            if planned > 0:
                slide.rect(bar_x, y, max(0.03, bar_w * planned / max_value), 0.13, "2F6FED")
            if completed > 0:
                slide.rect(bar_x, y + 0.18, max(0.03, bar_w * completed / max_value), 0.13, "16875F")
            slide.text(value_x, y + 0.04, 2.1, 0.22, f"{int(planned):,} planned / {int(completed):,} completed", size=8, bold=True, color="354052")
            y += row_h

        slide.text(0.62, 7.05, 5.0, 0.18, f"{title}: rows {start}-{end} of {len(rows)}", size=7, color="647084")
        slides.append(slide)
    return slides


def pptx_chart_rows(
    title: str,
    payload: dict,
    rows: list[dict],
    value_mode: str,
    color: str,
    empty_message: str,
    rows_per_slide: int = 14,
) -> list[PptSlide]:
    if not rows:
        slide = PptSlide()
        pptx_add_background(slide)
        pptx_add_header(slide, title, payload, "No rows available for this chart")
        slide.rect(0.8, 1.55, 11.75, 4.9, "FFFFFF", "D8DEE8")
        slide.text(1.05, 3.65, 11.15, 0.36, empty_message, size=14, bold=True, color="647084", align="ctr")
        return [slide]

    slides: list[PptSlide] = []
    chunks = [rows[index : index + rows_per_slide] for index in range(0, len(rows), rows_per_slide)]
    for page_index, chunk in enumerate(chunks):
        slide = PptSlide()
        pptx_add_background(slide)
        start = page_index * rows_per_slide + 1
        end = start + len(chunk) - 1
        suffix = f" ({page_index + 1}/{len(chunks)})" if len(chunks) > 1 else ""
        subtitle = f"Rows {start}-{end} of {len(rows)} | All rows included"
        pptx_add_header(slide, f"{title}{suffix}", payload, subtitle)
        slide.rect(0.6, 1.32, 12.2, 5.55, "FFFFFF", "D8DEE8")

        max_total = max(1.0, *(pdf_number(row.get("total")) for row in chunk))
        y = 1.62
        label_x = 0.86
        label_w = 2.55
        bar_x = 3.62
        bar_w = 6.72
        value_x = 10.58
        row_h = 0.36
        for row in chunk:
            label = pptx_truncate(row.get("label") or "Unspecified", 34)
            if value_mode == "rate":
                rate = max(0.0, min(1.0, pdf_number(row.get("rate"))))
                on_time = int(pdf_number(row.get("onTime")))
                eligible = int(pdf_number(row.get("eligible")))
                bar_ratio = rate
                value_text = f"{rate:.0%} ({on_time}/{eligible})"
            elif value_mode == "team":
                total = pdf_number(row.get("total"))
                outside = int(pdf_number(row.get("outsideTimeline")))
                on_time_rate = pdf_number(row.get("onTimeRate"))
                bar_ratio = total / max_total
                value_text = f"{int(total):,} total | {outside} risk | {on_time_rate:.0%}"
            else:
                total = pdf_number(row.get("total"))
                rate = pdf_number(row.get("rate"))
                bar_ratio = total / max_total
                value_text = f"{int(total):,} ({rate:.0%})"

            slide.text(label_x, y, label_w, 0.22, label, size=8, color="354052", align="r")
            slide.rect(bar_x, y + 0.06, bar_w, 0.16, "EAF0F7")
            if bar_ratio > 0:
                slide.rect(bar_x, y + 0.06, max(0.03, bar_w * min(1.0, bar_ratio)), 0.16, color)
            slide.text(value_x, y, 2.1, 0.22, value_text, size=8, bold=True, color=color)
            y += row_h

        slide.text(0.62, 7.05, 4.4, 0.18, f"{title}: rows {start}-{end} of {len(rows)}", size=7, color="647084")
        slides.append(slide)
    return slides


def pptx_relationships_xml(relationships: list[tuple[str, str, str]]) -> str:
    items = "\n".join(
        f'<Relationship Id="{rid}" Type="{rtype}" Target="{target}"/>' for rid, rtype, target in relationships
    )
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
{items}
</Relationships>"""


def pptx_content_types_xml(slide_count: int) -> str:
    slide_overrides = "\n".join(
        f'<Override PartName="/ppt/slides/slide{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
        for index in range(1, slide_count + 1)
    )
    layout_overrides = "\n".join(
        f'<Override PartName="/ppt/slideLayouts/slideLayout{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
        for index in range(1, 12)
    )
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>
  <Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>
  {layout_overrides}
  {slide_overrides}
</Types>"""


def pptx_presentation_xml(slide_count: int) -> str:
    slide_ids = "\n".join(
        f'<p:sldId id="{255 + index}" r:id="rId{index + 1}"/>' for index in range(1, slide_count + 1)
    )
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                saveSubsetFonts="1">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rId1"/>
  </p:sldMasterIdLst>
  <p:sldIdLst>
    {slide_ids}
  </p:sldIdLst>
  <p:sldSz cx="{PPTX_SLIDE_CX}" cy="{PPTX_SLIDE_CY}"/>
  <p:notesSz cx="6858000" cy="9144000"/>
  <p:defaultTextStyle>
    <a:defPPr><a:defRPr lang="en-US"/></a:defPPr>
  </p:defaultTextStyle>
</p:presentation>"""


def pptx_presentation_rels_xml(slide_count: int) -> str:
    relationships = [
        ("rId1", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster", "slideMasters/slideMaster1.xml")
    ]
    relationships.extend(
        (f"rId{index + 1}", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide", f"slides/slide{index}.xml")
        for index in range(1, slide_count + 1)
    )
    next_id = slide_count + 2
    relationships.extend(
        [
            (f"rId{next_id}", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps", "presProps.xml"),
            (f"rId{next_id + 1}", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps", "viewProps.xml"),
            (f"rId{next_id + 2}", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme", "theme/theme1.xml"),
            (f"rId{next_id + 3}", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles", "tableStyles.xml"),
        ]
    )
    return pptx_relationships_xml(relationships)


def pptx_slide_layout_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
             xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
             type="blank" preserve="1">
  <p:cSld name="Blank">
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>"""


def pptx_slide_master_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
             xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
  <p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>
</p:sldMaster>"""


def pptx_theme_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1F2937"/></a:dk2>
      <a:lt2><a:srgbClr val="F6F8FB"/></a:lt2>
      <a:accent1><a:srgbClr val="2F6FED"/></a:accent1>
      <a:accent2><a:srgbClr val="16875F"/></a:accent2>
      <a:accent3><a:srgbClr val="6F52B5"/></a:accent3>
      <a:accent4><a:srgbClr val="B7791F"/></a:accent4>
      <a:accent5><a:srgbClr val="C2413B"/></a:accent5>
      <a:accent6><a:srgbClr val="0F766E"/></a:accent6>
      <a:hlink><a:srgbClr val="2F6FED"/></a:hlink>
      <a:folHlink><a:srgbClr val="6F52B5"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office">
      <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst>
      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
      <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
  <a:objectDefaults/>
  <a:extraClrSchemeLst/>
</a:theme>"""


def build_pptx(slides: list[PptSlide]) -> bytes:
    if not PPTX_TEMPLATE_PATH.exists():
        raise FileNotFoundError("The PowerPoint template file pptx_template.pptx is missing.")

    now = dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    app_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
            xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Change Timeline Analyzer</Application>
  <PresentationFormat>Widescreen</PresentationFormat>
  <Slides>{len(slides)}</Slides>
</Properties>"""
    core_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
                   xmlns:dc="http://purl.org/dc/elements/1.1/"
                   xmlns:dcterms="http://purl.org/dc/terms/"
                   xmlns:dcmitype="http://purl.org/dc/dcmitype/"
                   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Jira Change Executive Summary</dc:title>
  <dc:creator>Change Timeline Analyzer</dc:creator>
  <cp:lastModifiedBy>Change Timeline Analyzer</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified>
</cp:coreProperties>"""

    output = io.BytesIO()
    dynamic_parts = {
        "[Content_Types].xml",
        "docProps/app.xml",
        "docProps/core.xml",
        "ppt/presentation.xml",
        "ppt/_rels/presentation.xml.rels",
    }
    with zipfile.ZipFile(PPTX_TEMPLATE_PATH, "r") as template, zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for item in template.infolist():
            if item.filename in dynamic_parts or item.filename.startswith("ppt/slides/"):
                continue
            archive.writestr(item, template.read(item.filename))

        archive.writestr("[Content_Types].xml", pptx_content_types_xml(len(slides)))
        archive.writestr("docProps/app.xml", app_xml)
        archive.writestr("docProps/core.xml", core_xml)
        archive.writestr("ppt/presentation.xml", pptx_presentation_xml(len(slides)))
        archive.writestr("ppt/_rels/presentation.xml.rels", pptx_presentation_rels_xml(len(slides)))
        for index, slide in enumerate(slides, start=1):
            archive.writestr(f"ppt/slides/slide{index}.xml", slide.xml())
            archive.writestr(
                f"ppt/slides/_rels/slide{index}.xml.rels",
                pptx_relationships_xml(
                    [("rId1", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout", "../slideLayouts/slideLayout7.xml")]
                ),
            )
    return output.getvalue()


def generate_executive_pptx(payload: dict) -> bytes:
    slides = [pptx_overview_slide(payload)]
    slides.extend(pptx_timeline_rows(payload, payload.get("timeline", [])))
    slides.extend(
        pptx_chart_rows(
            "Change Type Mix",
            payload,
            payload.get("changeTypes", []),
            "count",
            "2F6FED",
            "No change type data was found.",
        )
    )
    slides.extend(
        pptx_chart_rows(
            "Status Mix",
            payload,
            payload.get("statuses", []),
            "count",
            "16875F",
            "No status data was found.",
        )
    )
    slides.extend(
        pptx_chart_rows(
            "Risk Level Mix",
            payload,
            payload.get("riskLevels", []),
            "count",
            "C2413B",
            "No risk level data was found.",
        )
    )
    slides.extend(
        pptx_chart_rows(
            "On-Time Finish Rate by Team",
            payload,
            payload.get("onTimeTeams", []),
            "rate",
            "6F52B5",
            "No completed planned changes were found.",
        )
    )
    slides.extend(
        pptx_chart_rows(
            "Changes by Team",
            payload,
            payload.get("topTeams", []),
            "team",
            "2F6FED",
            "No team data was found.",
        )
    )
    return build_pptx(slides)


def pptx_response(handler: BaseHTTPRequestHandler, pptx: bytes, filename: str) -> None:
    handler.send_response(200)
    handler.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation")
    handler.send_header("Content-Disposition", f'attachment; filename="{filename}"')
    handler.send_header("Content-Length", str(len(pptx)))
    handler.end_headers()
    handler.wfile.write(pptx)


class ChangeAnalyzerHandler(BaseHTTPRequestHandler):
    server_version = "ChangeAnalyzer/1.0"

    def do_GET(self) -> None:
        path = unquote(urlparse(self.path).path)
        if path == "/":
            path = "/index.html"
        safe_path = posixpath.normpath(path).lstrip("/")
        file_path = (STATIC_ROOT / safe_path).resolve()
        if not str(file_path).startswith(str(STATIC_ROOT.resolve())) or not file_path.exists():
            self.send_error(404, "File not found")
            return

        content = file_path.read_bytes()
        content_type = CONTENT_TYPES.get(file_path.suffix.lower()) or mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/pptx":
            try:
                payload = read_json_body(self)
                pptx = generate_executive_pptx(payload)
                pptx_response(self, pptx, "change-executive-summary.pptx")
            except Exception as exc:
                json_response(self, {"error": str(exc)}, status=400)
            return
        if path == "/api/pdf":
            try:
                payload = read_json_body(self)
                pdf = generate_executive_pdf(payload)
                pdf_response(self, pdf, "change-executive-summary.pdf")
            except Exception as exc:
                json_response(self, {"error": str(exc)}, status=400)
            return
        if path != "/api/parse":
            self.send_error(404, "Endpoint not found")
            return
        try:
            filename, data = read_upload(self)
            payload = parse_uploaded_file(filename, data)
            json_response(self, payload)
        except Exception as exc:
            json_response(self, {"error": str(exc)}, status=400)

    def log_message(self, format: str, *args: object) -> None:
        sys.stdout.write("%s - %s\n" % (self.address_string(), format % args))


def main() -> None:
    port = int(os.environ.get("PORT", "8000"))
    host = os.environ.get("HOST", "0.0.0.0")
    server = ThreadingHTTPServer((host, port), ChangeAnalyzerHandler)
    display_host = "127.0.0.1" if host == "0.0.0.0" else host
    print(f"Change Timeline Analyzer running at http://{display_host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
