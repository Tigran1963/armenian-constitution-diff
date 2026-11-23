#!/usr/bin/env python3
"""Extract the provided editions using Poppler. Run from the repository root."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

ARMENIAN = re.compile(r"[Ա-Ֆա-և]")
CHAPTER = re.compile(r"^\s*Գ\s*Լ\s*ՈՒ\s*Խ\s+([0-9]+)(?:[․.:])?(?:\s|$)", re.I)
CHAPTER_RU = re.compile(r"^\s*Г\s*Л\s*А\s*В\s*А\s+([0-9]+)(?:[.:])?(?:\s|$)", re.I)
ARTICLE = re.compile(r"^\s*(?:Հոդված|Статья)\s+(\d+)([.․։])\s*(.*)$")
ARTICLE_START = re.compile(r"^\s*(?:Հոդված|Статья)(?:\s|$)")
CYRILLIC = re.compile(r"[А-Яа-яЁё]")
DRAFT_RU_HEADER = "ПРОЕКТ КОНСТИТУЦИИ РЕСПУБЛИКИ АРМЕНИЯ | ПЕРЕВОД С АРМЯНСКОГО"
MARKER = re.compile(r"^\s*\d+[.)․։]\s+\S")
DANGLING = re.compile(r"^\s*(\d+[.․։])\s*(.*)$")
START = {
    "old": ("Հայ ժողովուրդը,", "«Հայ ժողովուրդը,"),
    "new": ("Մենք՝",),
    "old_ru": ("“Армянский народ,",),
    "new_ru": ("Мы, народ Республики Армения,",),
}
EXPECTED = {"old": (220, 16), "new": (89, 12), "old_ru": (220, 16), "new_ru": (89, 12)}


def command(*args):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE).stdout.decode("utf-8")


def issue(issues, code, page, fragment="", severity="review"):
    issues.append(dict(code=code, page=page, fragment=fragment[:350], severity=severity))


def ocr_page(pdf, page, language="hye"):
    with tempfile.TemporaryDirectory() as folder:
        image = str(Path(folder) / "page")
        command("pdftoppm", "-f", str(page), "-l", str(page), "-r", "300", "-singlefile", "-png", str(pdf), image)
        return command("tesseract", image + ".png", "stdout", "-l", language, "--psm", "3")


def read_pages(pdf, issues, ocr=False):
    raw = command("pdftotext", "-enc", "UTF-8", "-layout", str(pdf), "-")
    count = int(re.search(r"^Pages:\s+(\d+)", command("pdfinfo", str(pdf)), re.M)[1])
    pages = raw.removesuffix("\f").split("\f")
    if len(pages) != count:
        issue(issues, "page-count", None, f"{len(pages)} / {count}", "error")
    for number, page in enumerate(pages, 1):
        if len(ARMENIAN.findall(page)) + (len(CYRILLIC.findall(page)) if pdf.stem.endswith("_ru") else 0) < 20:
            issue(issues, "weak-text-layer", number, page, "error")
            if ocr:
                try:
                    page = ocr_page(pdf, number, "rus") if pdf.stem.endswith("_ru") else ocr_page(pdf, number)
                    issue(issues, "ocr-needs-proofreading", number, page)
                except (FileNotFoundError, subprocess.CalledProcessError) as error:
                    issue(issues, "ocr-failed", number, str(error), "error")
        if re.search(r"\ufffd|\u25a0|[\x00-\x08\x0b\x0e-\x1f]|\(cid:\d+\)", page):
            issue(issues, "unreadable-glyph", number, page, "error")
        for line in page.splitlines():
            yield number, line


def clean(line):
    return re.sub(r"\s+", " ", line.strip())


# These compounds were checked in the Russian sources. Keep the printed hyphen.
RUSSIAN_COMPOUNDS = {
    "какую": {"либо"}, "каким": {"либо"}, "премьер": {"министром", "министра", "министру"},
    "административно": {"территориальное"}, "денежно": {"кредитной"},
}


def join(lines, issues):
    result = ""
    for page, raw in lines:
        line = clean(raw)
        if not line:
            continue
        left = re.search(r"([а-яё]+)-$", result, re.I)
        right = re.match(r"[а-яё]+", line, re.I)
        known_compound = left and right and right[0].lower() in RUSSIAN_COMPOUNDS.get(left[1].lower(), ())
        if known_compound or re.search(r"\d-$", result) and re.match(r"(?:րդ|ին|ով|ի|ը|\d+)\b", line):
            result += line
        elif result.endswith(("-", "֊", "\u00ad")):
            issue(issues, "ambiguous-line-end-hyphen", page, result[-90:] + "\n" + line)
            result += "\n" + line
        else:
            result += (" " if result else "") + line
    # Justified lines can insert a space between a word and its punctuation.
    return re.sub(r"(?<=\S) +([,։․.])(?= |$)", r"\1", result)


def split_blocks(lines, chapter_pattern, layout):
    block = []
    blanks = 0
    for page, line in lines:
        if not line.strip():
            blanks += 1
            continue
        starts_structure = chapter_pattern.match(line) or ARTICLE_START.match(line)
        if block:
            # Poppler sometimes inserts blank lines across physical page boundaries.
            starts_body = (
                layout == "wrapper" and page != block[-1][0] and ARTICLE_START.match(block[0][1])
                and not DANGLING.match(line) and 2 <= len(line) - len(line.lstrip()) <= 4
            )
            if starts_structure or starts_body or (blanks >= (1 if layout == "current" else 2) and page == block[-1][0]):
                yield block
                block = []
        block.append((page, line))
        blanks = 0
    if block:
        yield block


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def extract(kind, lines, issues):
    lines = list(lines)
    start = next((index for index, (_, line) in enumerate(lines) if clean(line).startswith(START[kind])), None)
    if start is None:
        issue(issues, "preamble-missing", None, "", "error")
        return "", [], []
    end = len(lines)
    first_text = clean(lines[start][1])
    wrapped = kind == "old_ru" or first_text.startswith("«")
    layout = "wrapper" if wrapped else "current" if kind == "old" else "draft"
    chapter_pattern = CHAPTER_RU if kind.endswith("_ru") else CHAPTER
    if wrapped:
        closing = r'”\.\s*$' if kind == "old_ru" else r'»[:։]\s*$'
        for index in range(start, end):
            if re.search(closing, lines[index][1]) and any(
                "220." in value for _, value in lines[max(start, index - 28):index]
            ):
                end = index + 1
                break
        if end == len(lines):
            issue(issues, "amendment-boundary-missing", None, "", "error")
        lines[start] = (lines[start][0], re.sub(r"[«“]", "", lines[start][1], count=1))
        if end < len(lines):
            page, line = lines[end - 1]
            lines[end - 1] = (page, line.replace("”.", ".") if kind == "old_ru" else re.sub(closing, "", line))
    scoped = [
        (page, line) for page, line in lines[start:end]
        if not re.fullmatch(r"\s*\d+\s*", line)
        and not (kind == "new_ru" and (clean(line) == DRAFT_RU_HEADER or re.fullmatch(r"— *\d+ *—", clean(line))))
    ]
    markdown = []
    articles = []
    chapters = []
    paragraphs = []
    heading = None
    block_type = "preamble"

    def write_heading():
        nonlocal heading
        if heading:
            marker, title_lines = heading
            markdown.append(marker + join(title_lines, issues))
            if marker == '### ' and not ARTICLE_START.match(title_lines[0][1]):
                issue(issues, "invalid-heading", title_lines[0][0], title_lines[0][1], "error")
            heading = None

    def flush():
        write_heading()
        if paragraphs:
            markdown.extend(join(paragraph, issues) for paragraph in paragraphs)
            paragraphs.clear()

    def paragraph(page, line, force=False):
        if force or not paragraphs:
            paragraphs.append([])
        paragraphs[-1].append((page, line))

    for block in split_blocks(scoped, chapter_pattern, layout):
        page, first = block[0]
        line = clean(first)
        chapter = chapter_pattern.match(line)
        article = ARTICLE.match(line)
        body = block
        if chapter:
            flush()
            block_type = "chapter"
            chapters.append(int(chapter[1]))
            heading = ("## ", block[:1])
            body = block[1:]
        elif ARTICLE_START.match(line):
            flush()
            if article and kind.startswith("old") and int(article[1]) <= 2:
                articles.append((int(article[1]), page))
                markdown.append("### " + line[:article.start(3)].rstrip())
                block_type = "body"
                body = ([(page, article[3])] if article[3] else []) + block[1:]
            elif article:
                articles.append((int(article[1]), page))
                block_type = "title"
                heading = ("### ", block[:1])
                body = block[1:]
            elif wrapped and len(block) > 1 and (number := DANGLING.match(block[1][1])):
                articles.append((int(number[1][:-1]), page))
                block_type = "title"
                label, _, title = line.partition(" ")
                heading = ("### ", [(page, f"{label} {number[1]} {title}")])
                if number[2]:
                    heading[1].append((block[1][0], number[2]))
                body = block[2:]
            else:
                issue(issues, "unparsed-article", page, line, "error")
        elif block_type == "title":
            write_heading()
            block_type = "body"
        elif block_type == "body" and paragraphs:
            # Blocks inside an article can mark unnumbered paragraphs.
            paragraphs.append([])

        for item_page, actual in body:
            if heading and not MARKER.match(actual):
                heading[1].append((item_page, actual))
            else:
                write_heading()
                if block_type != "preamble":
                    block_type = "body"
                starts_paragraph = bool(MARKER.match(actual)) or wrapped and actual.startswith("  ") or (
                    block_type == "preamble" and (
                        kind == "new" and clean(actual).startswith("Սահմանադրությունը մեր") or
                        kind == "new_ru" and clean(actual).startswith("Конституция является нашим")
                    ))
                paragraph(item_page, actual, starts_paragraph and bool(paragraphs and paragraphs[-1]))

    flush()
    expected_articles, expected_chapters = EXPECTED[kind]
    if [number for number, _ in articles] != list(range(1, expected_articles + 1)):
        issue(issues, "article-sequence", None, repr(articles), "error")
    if chapters != list(range(1, expected_chapters + 1)):
        issue(issues, "chapter-sequence", None, repr(chapters), "error")

    def compact(value):
        return re.sub(r"\s+", "", value)

    from collections import Counter
    read_chars = Counter(compact("".join(line for _, line in scoped)))
    output_chars = Counter(compact("".join(re.sub(r"^#{2,3} ", "", part) for part in markdown)))
    if read_chars != output_chars:
        issue(issues, "character-inventory", None, f"Missing {read_chars - output_chars}; extra {output_chars - read_chars}", "error")
    return "\n\n".join(part for part in markdown if part) + "\n", articles, chapters


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ocr", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    target = Path("content")
    target.mkdir(exist_ok=True)
    reports = {}
    files = {}
    for kind in START:
        pdf = Path("sources") / f"{kind}.pdf"
        issues = []
        lines = list(read_pages(pdf, issues, args.ocr))
        markdown, articles, chapters = extract(kind, lines, issues)
        files[target / f"{kind}.md"] = markdown
        reports[kind] = {
            "sourceSha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
            "markdownSha256": digest(markdown),
            "pages": max((page for page, _ in lines), default=0),
            "articles": len(articles),
            "chapters": len(chapters),
            "articlePages": dict(articles),
            "preamblePage": next((page for page, line in lines if clean(line).startswith(START[kind])), None),
            "issues": issues,
        }
    files[target / "extraction-report.json"] = json.dumps(reports, ensure_ascii=False, indent=2) + "\n"
    failed = False
    for path, data in files.items():
        if args.check:
            if not path.exists() or path.read_text(encoding="utf-8") != data:
                print(f"{path}: generated output differs")
                failed = True
        else:
            path.write_text(data, encoding="utf-8")
    for kind, report in reports.items():
        print(f"{kind}: {report['pages']} pages, {report['chapters']} chapters, {report['articles']} articles, {len(report['issues'])} findings")
        for finding in report["issues"]:
            print(f"  {finding['severity']} {finding['code']} (page {finding['page']}): {finding['fragment']}")
            failed |= finding["severity"] == "error"
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
