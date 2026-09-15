"""
Luminus Bulk Automation — PDF Extraction Service
Phase 2: Deterministic parsing against the lead-vendor template

Extracts per-client and per-item data from uploaded lead PDFs.
Fields are matched to the existing proposalStore.js data model.

Usage (called by server.js via child_process):
  python extraction/extractor.py <path_to_pdf>

Output: JSON printed to stdout (parsed by Node.js)
Errors: Non-zero exit code + message on stderr
"""

import base64
import json
import os
import re
import sys
import time
import threading
import urllib.error
import urllib.request
import concurrent.futures
from pathlib import Path
import argparse

# Global lock: Florence runs on a single CPU so we must serialize requests
_florence_lock = threading.Lock()

try:
    import pdfplumber
except ImportError:
    print(json.dumps({"error": "pdfplumber not installed. Run: pip install pdfplumber"}))
    sys.exit(1)

# pypdf was previously used for raw image extraction, now replaced by PyMuPDF rendering.
# Kept as optional import for any future PDF metadata needs.
try:
    from pypdf import PdfReader
except ImportError:
    PdfReader = None  # Non-fatal: PyMuPDF is used for all image work now

try:
    import fitz  # PyMuPDF for rendering + optional OCR fallback
except ImportError:
    fitz = None

try:
    import pytesseract
except ImportError:
    pytesseract = None


# ----------------------------------------------------------------
# REGEX PATTERNS — tuned to the Luminus lead-vendor template
# ----------------------------------------------------------------

# Email: standard RFC-like pattern
RE_EMAIL = re.compile(
    r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}",
    re.IGNORECASE
)

# Phone number (optional enrichment, not stored as required field)
RE_PHONE = re.compile(
    r"(\+?1?\s?)?(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})"
)

# Dimensions: e.g.  24in x 24in | 24" x 24" | 24 x 24 inches | 2ft x 3ft
RE_DIMENSION = re.compile(
    r"""
    (\d+(?:\.\d+)?)\s*       # width
    (?:in(?:ches?)?|ft|feet|cm|mm|\")?
    \s*[xX×]\s*              # separator
    (\d+(?:\.\d+)?)\s*       # height
    (?:in(?:ches?)?|ft|feet|cm|mm|\")?
    """,
    re.VERBOSE | re.IGNORECASE
)

# Price: $123 | $1,234.56 | 123 USD  (the $/USD is required to avoid picking dimensions)
RE_PRICE_STRICT = re.compile(
    r"\$\s*(\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?)"
)

# Loose numeric fallback (used only when no strict prices are found)
RE_PRICE = re.compile(
    r"\$?\s*(\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?)"
)

# Sign type keywords found in Luminus proposals and general industry
SIGN_TYPE_KEYWORDS = [
    "3D Metal Back-lit",
    "3D Metal Backlit",
    "Channel Letter",
    "Channel Letters",
    "LED Cabinet",
    "Cabinet Sign",
    "Box Sign",
    "Monument Sign",
    "Pylon Sign",
    "Blade Sign",
    "Awning Sign",
    "Face Lit",
    "Reverse Lit",
    "Halo Lit",
    "Push-Thru",
    "Dimensional Letter",
    "Flat Cut Letters",
    "Foam Letters",
    "Lightbox",
    "Backlit",
    "Neon",
    "LED",
    "Acrylic Panel",
    "Acrylic Panel Sign",
    "Post Sign",
    "A-Frame",
    "Feather Flag",
    "Directional Sign",
    "Wayfinding",
    "Plaque",
    "Banners",
    "Vinyl Graphics",
    "Window Graphics",
    "Vehicle Wrap"
]

# Size tier keywords (from proposalStore.js)
SIZE_TIERS = ["Small", "Medium", "Large", "XL", "Custom"]


# ----------------------------------------------------------------
# HELPER FUNCTIONS
# ----------------------------------------------------------------

def clean_text(text: str) -> str:
    """Strip extra whitespace and normalize unicode."""
    if not text:
        return ""
    return " ".join(text.split())


def extract_email(text: str) -> str | None:
    """Return the first valid email found in text."""
    match = RE_EMAIL.search(text)
    return match.group(0).lower() if match else None


def extract_prices_strict(text: str) -> list[float]:
    """Return prices that have a $ symbol in the text."""
    prices = []
    for match in RE_PRICE_STRICT.finditer(text):
        raw = match.group(1).replace(",", "")
        try:
            prices.append(float(raw))
        except ValueError:
            continue
    return prices


def extract_price_candidates(text: str) -> list[float]:
    """Return all numeric prices found in text, ordered by appearance."""
    candidates = []
    for match in RE_PRICE.finditer(text):
        raw = match.group(1).replace(",", "")
        try:
            candidates.append(float(raw))
        except ValueError:
            continue
    return candidates


# ----------------------------------------------------------------
# PyMuPDF TEXT FALLBACK (some PDFs render text in ways pdfplumber misses)
# ----------------------------------------------------------------

def pymupdf_page_text(pdf_path: str, page_num: int) -> str:
    """Extract text from a page using PyMuPDF. Returns empty string on failure."""
    if fitz is None:
        return ""
    try:
        doc = fitz.open(pdf_path)
        page = doc.load_page(page_num)
        text = page.get_text()
        doc.close()
        return text
    except Exception as exc:
        print(f"PyMuPDF text warning (page {page_num + 1}): {exc}", file=sys.stderr)
        return ""


# ----------------------------------------------------------------
# OCR FALLBACK (for scanned / image-based PDFs)
# ----------------------------------------------------------------

def find_tesseract_binary() -> str | None:
    """
    Locate the Tesseract executable on Windows / Linux / macOS.
    Checks env var, PATH, then common install locations.
    """
    import shutil
    from pathlib import Path

    # 1. Explicit override from environment
    env_cmd = os.environ.get("TESSERACT_CMD")
    if env_cmd and Path(env_cmd).exists():
        return env_cmd

    # 2. PATH
    exe = shutil.which("tesseract")
    if exe:
        return exe

    # 3. Common Windows locations (winget, manual, chocolatey, scoop)
    candidates = [
        Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
        Path(r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"),
        Path.home() / r"AppData\Local\Programs\Tesseract-OCR\tesseract.exe",
        Path.home() / r"scoop\apps\tesseract\current\tesseract.exe",
        Path.home() / r"scoop\shims\tesseract.exe",
        Path(r"C:\ProgramData\chocolatey\bin\tesseract.exe"),
        Path(r"C:\Tools\Tesseract-OCR\tesseract.exe"),
        Path(r"C:\Tesseract-OCR\tesseract.exe"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)

    return None


def configure_tesseract() -> bool:
    """Configure pytesseract to use the found binary. Returns True if configured."""
    if pytesseract is None:
        return False
    binary = find_tesseract_binary()
    if binary:
        pytesseract.pytesseract.tesseract_cmd = binary
        return True
    return False


def ocr_image_file(img_path: str) -> str:
    """
    Run OCR on a saved image file using pytesseract.
    Returns empty string if pytesseract is unavailable.
    """
    if pytesseract is None:
        return ""
    if not configure_tesseract():
        return ""

    try:
        from PIL import Image
        img = Image.open(img_path)
        text = pytesseract.image_to_string(img)
        print(f"OCR text (image): {text[:500].replace(chr(10), ' ')}...", file=sys.stderr)
        return text
    except Exception as exc:
        print(f"OCR error (image {img_path}): {exc}", file=sys.stderr)
        return ""


# ----------------------------------------------------------------
# GEMINI VISION FALLBACK (for image-based or oddly-rendered PDFs)
# ----------------------------------------------------------------

def render_page_to_jpeg(pdf_path: str, page_num: int, dpi: int = 150) -> bytes | None:
    """Render a single PDF page to a JPEG byte string."""
    if fitz is None:
        return None
    try:
        doc = fitz.open(pdf_path)
        page = doc.load_page(page_num)
        mat = fitz.Matrix(dpi / 72, dpi / 72)
        pix = page.get_pixmap(matrix=mat)
        img_bytes = pix.tobytes("jpeg")
        doc.close()
        return img_bytes
    except Exception as exc:
        print(f"Render warning (page {page_num + 1}): {exc}", file=sys.stderr)
        return None


GEMINI_VISION_PROMPT = """You are a structured data extraction assistant for a sign-company proposal system.

Look at the attached image of a sign quote/proposal PDF page and return ONLY a JSON object (no markdown, no explanation).

Use this exact structure and infer the best values from the visible text:

{
  "client_name": "First Last or Company name",
  "client_email": "email@example.com or empty string",
  "sign_type": "e.g. Acrylic Panel Sign, Channel Letters, 3D Metal Back-lit",
  "size": "e.g. 115.5 in x 23.2 in, Small, Medium, Large, or Custom",
  "dimensions": "width x height with units, or same as size",
  "color": "e.g. Same as Mockup, Black, White, Red",
  "finish": "e.g. Matte, Glossy, Brushed",
  "illuminated": "Yes or No",
  "usage": "e.g. Indoor or Outdoor",
  "ul_cert": "Yes / No / Only For Illuminated variants",
  "permit": "e.g. On Demand",
  "install": "e.g. On Demand",
  "original_price": 1440,
  "discounted_price": 1296,
  "discount_code": "SM10SALE",
  "pricing": [
    {"size": "Small", "dim": "24in x 24in", "cost": 570, "discounted_cost": 513}
  ]
}

Rules for prices:
- If you see a "Discounted Price" section with two numbers, the first is original_price and the second is discounted_price.
- If you see only one price, put it in original_price and leave discounted_price null.
- Return numbers as JSON numbers, not strings.
- If the image has no pricing table, return pricing as an empty array.

Rules for size:
- Prefer the exact dimension like "115.5 in x 23.2 in" if visible.
- If only a tier like "Large" is visible, use that.
- If both are visible, put the dimension in "size" and "dimensions".

If a field is not visible, return null or an empty string."""


def extract_page_with_ai_fallback(pdf_path: str, page_idx: int) -> dict:
    """Send a rendered page image to Gemini Vision for structured data extraction."""
    import os, json, sys
    img_bytes = render_page_to_jpeg(pdf_path, page_idx, dpi=200)
    if not img_bytes:
        return {}

    gemini_key = os.environ.get("VITE_GEMINI_API_KEY")
    if not gemini_key:
        print("⚠️ VITE_GEMINI_API_KEY is missing in .env! Cannot extract.", file=sys.stderr)
        return {}

    # ----------------------------------------------------------------
    # GEMINI PROMPT — Clear field-by-field rules, no contradictions
    # ----------------------------------------------------------------
    prompt = """You are a precise data extraction assistant for a sign-company proposal system.

Look at this PDF page image and return ONLY a single JSON object — no markdown, no explanation.

FIELD EXTRACTION RULES (apply in this exact priority order):

1. client_name: Look for "Attn:", "Client:", "Prepared For:", "Bill To:", or the name shown under a "Quote Details" heading. Return the person or company name as a string. If not found, return null.

2. client_email: Find any email address (user@domain.com format). Return it lowercase. If not found, return null.

3. sign_type: This is the MOST important field. Read the label "SIGN TYPE" or "Product" or "Item" and return its value exactly as written (e.g. "3D Metal Back-lit", "Channel Letters", "Neon Acrylic"). If no label exists, identify the sign type from visual context (e.g. a neon sign = "Neon Sign"). NEVER return "Details", "Quote", or field label names as the value.

4. size / dimensions: Look for a dimension pattern like "115.5 in x 23.2 in" or "24\" x 36\"". Return the full dimension string. If only a tier label is visible (Small/Medium/Large), return that.

5. original_price: Look for the FIRST price number shown under "Price", "Total", or "Discounted Price" sections. Return as a JSON number (not string). If the section says "Discounted Price" and shows TWO numbers, the first (larger) is original_price.

6. discounted_price: If a "Discounted Price" section shows TWO numbers, the second (smaller) one is discounted_price. Otherwise null.

7. pricing: If there is a table of Small/Medium/Large options, extract each row. Each row: {"size": "Small", "dim": "24in x 24in", "cost": 570, "discounted_cost": 513}. If no table, return [].

8. color: Read the "COLOR" label value. Return null if not visible.

9. finish: Read the "FINISH" label value. Return null if not visible.

10. illuminated: Read "ILLUMINATED" label. Return "Yes" or "No" only. Return null if not visible.

11. usage: Read "USAGE" label. Return "Indoor" or "Outdoor" only. Return null if not visible.

12. ul_cert: Read "UL CERTIFICATION" label. Return the value text (e.g. "Only For Illuminated variants"). Return null if not visible.

13. permit: Read "PERMIT" label. Return its value (e.g. "On Demand"). Return null if not visible.

14. install: Read "INSTALLATION" label. Return its value (e.g. "On Demand"). NEVER return the sign type or dimensions here. Return null if not visible.

15. discount_code: Read "DISCOUNT CODE" label. Return the code string (e.g. "SM10SALE"). Return null if not visible.

Return this exact JSON structure:
{
  "client_name": null,
  "client_email": null,
  "sign_type": null,
  "size": null,
  "dimensions": null,
  "color": null,
  "finish": null,
  "illuminated": null,
  "usage": null,
  "ul_cert": null,
  "permit": null,
  "install": null,
  "original_price": null,
  "discounted_price": null,
  "discount_code": null,
  "pricing": []
}"""

    print(f"🤖 Gemini Vision extracting page {page_idx + 1}...", file=sys.stderr)
    try:
        import google.generativeai as genai
        from google.generativeai.types import HarmCategory, HarmBlockThreshold

        genai.configure(api_key=gemini_key)

        safety_settings = {
            HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
        }

        model = genai.GenerativeModel(
            model_name="gemini-2.5-flash",
            generation_config={"temperature": 0.0, "response_mime_type": "application/json"},
            safety_settings=safety_settings
        )

        img_part = {"mime_type": "image/jpeg", "data": img_bytes}
        response = model.generate_content([prompt, img_part])

        if response.text:
            res = json.loads(response.text)
            print(f"✅ Gemini Vision complete for page {page_idx + 1}", file=sys.stderr)
            return res
        else:
            print(f"⚠️ Gemini returned empty response for page {page_idx + 1}", file=sys.stderr)
            return {}

    except Exception as e:
        print(f"❌ Gemini Vision failed on page {page_idx + 1}: {e}", file=sys.stderr)
        return {"error": str(e)}


# Fields where Gemini's vision is MORE reliable than pdfplumber text parsing.
# For these, Gemini's value REPLACES the pdfplumber value (not just fills gaps).
_GEMINI_AUTHORITATIVE_FIELDS = {"sign_type", "color", "finish", "illuminated", "usage", "ul_cert", "permit", "install"}

# Garbage values that pdfplumber sometimes extracts (OCR noise, layout artifacts).
# If a field equals one of these, treat it as missing and let Gemini override.
_GARBAGE_VALUES = {
    "", "none", "null", "n/a", "details", "quote details", "client", "sign type",
    "dimensions", "color", "finish", "illuminated", "usage", "ul certification",
    "permit", "installation", "see below", "tbd", "yes no", "no yes"
}


def _is_garbage(val) -> bool:
    """Return True if a value extracted by pdfplumber looks like noise."""
    if val is None:
        return True
    return str(val).strip().lower() in _GARBAGE_VALUES


def merge_gemini_into_item(item: dict, gemini_data: dict) -> dict:
    """
    Merge Gemini Vision results into a text-extracted item.

    Strategy:
    - For authoritative fields (sign_type, color, etc.): ALWAYS use Gemini if
      it has a value, even if pdfplumber already found something (Gemini vision
      is more accurate than OCR text for these).
    - For price fields: only fill if pdfplumber found nothing, since regex
      prices are usually very accurate.
    - For size: fill gap only, pdfplumber dimension regex is reliable.
    """
    if not gemini_data or gemini_data.get("error"):
        return item

    # AUTHORITATIVE fields: Gemini overrides pdfplumber if Gemini found a value
    for key in _GEMINI_AUTHORITATIVE_FIELDS:
        gemini_val = gemini_data.get(key)
        if gemini_val and not _is_garbage(gemini_val):
            # Override if pdfplumber value is missing OR looks like garbage
            if _is_garbage(item.get(key)):
                item[key] = str(gemini_val).strip()

    # GAP-FILL fields: only fill if pdfplumber left them empty
    for key in ["size", "discount_code"]:
        if _is_garbage(item.get(key)) and gemini_data.get(key) and not _is_garbage(gemini_data.get(key)):
            item[key] = str(gemini_data[key]).strip()

    # Use Gemini dimensions as size fallback
    if _is_garbage(item.get("size")) and gemini_data.get("dimensions") and not _is_garbage(gemini_data.get("dimensions")):
        item["size"] = str(gemini_data["dimensions"]).strip()

    # PRICES: only fill gaps (pdfplumber regex is very reliable for prices)
    if item.get("original_price") is None and gemini_data.get("original_price") is not None:
        try:
            item["original_price"] = float(gemini_data["original_price"])
        except (ValueError, TypeError):
            pass
    if item.get("discounted_price") is None and gemini_data.get("discounted_price") is not None:
        try:
            item["discounted_price"] = float(gemini_data["discounted_price"])
        except (ValueError, TypeError):
            pass

    # PRICING TABLE: fill gap only
    if not item.get("pricing") and gemini_data.get("pricing"):
        pricing = []
        for row in gemini_data["pricing"]:
            if isinstance(row, dict):
                pricing.append({
                    "size": str(row.get("size", "")).strip(),
                    "dim": str(row.get("dim", "")).strip(),
                    "cost": row.get("cost") if row.get("cost") is not None else None,
                    "discounted_cost": row.get("discounted_cost") if row.get("discounted_cost") is not None else None,
                })
        if pricing:
            item["pricing"] = pricing

    return item


def text_has_data(text: str) -> bool:
    """Return True if the extracted text looks like it has meaningful proposal data."""
    if not text:
        return False
    lower = text.lower()
    
    # Relaxed rules: If we find ANY of the core identifiers (sign type, dimension, price, or client indicators)
    # in a sufficient amount of text, we consider it valid textual data rather than an empty/scanned page.
    if len(text.strip()) < 50:
        return False
        
    has_sign_type = extract_sign_type(text) is not None or "sign" in lower
    has_dimension = extract_dimension(text) is not None or RE_DIMENSION.search(text) is not None
    has_price = bool(extract_prices_strict(text) or extract_price_candidates(text))
    has_client = bool(extract_email(text) or any(k in lower for k in ["quote details", "client", "attn", "attention", "proposal"]))
    
    # If it has at least 2 of the 4 key indicators, we assume the text extraction was successful
    indicators_found = sum([has_sign_type, has_dimension, has_price, has_client])
    return indicators_found >= 2


def parse_pricing_line(line: str) -> dict | None:
    """
    Parse a single pricing line like:
      'Small 24in x 24in 570 $513 USD'
      'Medium 36in x 35in 962 $866'
      'Large 48in x 47in 1721 1549 USD'
      'Small 24in x 24in $570 $513 USD'
    Returns { size, dim, cost, discounted_cost } or None.
    """
    line = clean_text(line)
    size = extract_size_tier(line)
    if not size:
        return None

    dim_match = RE_DIMENSION.search(line)
    if not dim_match:
        return None

    dim = f"{dim_match.group(1)}in x {dim_match.group(2)}in"

    # Remove the dimension substring so we don't accidentally grab its numbers as prices
    line_without_dim = line[:dim_match.start()] + line[dim_match.end():]

    # Find all numeric tokens with optional $ prefix / USD suffix, keeping order
    token_pattern = re.compile(
        r"\$?\s*(\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:USD)?",
        re.IGNORECASE
    )
    tokens = []
    for m in token_pattern.finditer(line_without_dim):
        raw = m.group(1).replace(",", "")
        try:
            value = float(raw)
        except ValueError:
            continue
        # Check if the token is preceded by a $ sign (allow spaces)
        preceding = line_without_dim[max(0, m.start() - 3):m.start()]
        has_dollar = "$" in preceding
        tokens.append({"value": value, "has_dollar": has_dollar, "position": m.start()})

    if not tokens:
        return None

    # Heuristic:
    # - If first token has no $ and second has $, first = cost, second = discounted
    # - If all tokens have $, first = cost, second = discounted
    # - If only one token, cost = discounted = that token
    if len(tokens) >= 2 and not tokens[0]["has_dollar"] and tokens[1]["has_dollar"]:
        cost = tokens[0]["value"]
        discounted = tokens[1]["value"]
    elif len(tokens) >= 2 and all(t["has_dollar"] for t in tokens[:2]):
        cost = tokens[0]["value"]
        discounted = tokens[1]["value"]
    elif len(tokens) >= 2:
        # Two plain numbers: assume first is cost, second is discounted
        cost = tokens[0]["value"]
        discounted = tokens[1]["value"]
    else:
        cost = discounted = tokens[0]["value"]

    return {
        "size": size,
        "dim": dim,
        "cost": cost,
        "discounted_cost": discounted
    }


def extract_pricing_table(page_text: str, page_tables: list) -> list[dict]:
    """
    Extract a full pricing table: Small/Medium/Large options with dimensions and prices.
    Tries structured tables first, then falls back to line-by-line parsing.
    """
    rows = []

    # --- Try structured tables first ---
    for table in page_tables:
        for row in table:
            if not row:
                continue
            row_text = " ".join(str(cell) for cell in row if cell)
            parsed = parse_pricing_line(row_text)
            if parsed:
                rows.append(parsed)

    if rows:
        return rows

    # --- Fallback: line-by-line parsing ---
    lines = [clean_text(ln) for ln in page_text.splitlines() if clean_text(ln)]
    for line in lines:
        parsed = parse_pricing_line(line)
        if parsed:
            rows.append(parsed)

    return rows


def extract_dimension(text: str) -> str | None:
    """Return the first dimension string found, normalized."""
    # Strip leading noise chars (?, *, etc.) that Tesseract adds before numbers
    cleaned = re.sub(r"[^\w\s\.xX×]+", " ", text)
    match = RE_DIMENSION.search(cleaned)
    if match:
        return f"{match.group(1)}in x {match.group(2)}in"
    return None


def extract_sign_type(text: str) -> str | None:
    """Match a known sign type keyword in text (case-insensitive)."""
    text_lower = text.lower()
    for kw in SIGN_TYPE_KEYWORDS:
        if kw.lower() in text_lower:
            return kw
    return None


def extract_size_tier(text: str) -> str | None:
    """Match Small/Medium/Large tier label."""
    for tier in SIZE_TIERS:
        if tier.lower() in text.lower():
            return tier
    return None


# ----------------------------------------------------------------
# SECTION-BASED EXTRACTION HELPERS
# ----------------------------------------------------------------

def extract_labeled_value(text: str, label_keywords: list[str], stop_labels: list[str] | None = None) -> str | None:
    """
    Extract a value after a label. Handles both same-line and multi-line layouts.

    label_keywords: e.g. ['sign type', 'sign_type'] — matched case-insensitively.
    stop_labels: list of next-label keywords that stop the value scan.
    """
    if stop_labels is None:
        stop_labels = ['sign type', 'dimensions', 'color', 'finish', 'illuminated', 'usage',
                       'ul certification', 'ul certified', 'permit', 'installation',
                       'client', 'discount', 'price', 'discounted price', 'package']

    lines = [clean_text(ln) for ln in text.splitlines() if clean_text(ln)]

    # Normalize keywords
    label_regexes = [re.escape(kw) for kw in label_keywords]

    for i, line in enumerate(lines):
        # Check if this line starts with one of the labels (allowing optional colon/dash)
        if not re.match(r"^\s*(?:" + '|'.join(label_regexes) + r")\s*[:\-]?\s*", line, re.IGNORECASE):
            continue

        # --- Same-line value: everything after the label ---
        same_line = re.sub(r"^\s*(?:" + '|'.join(label_regexes) + r")\s*[:\-]?\s*", '', line, flags=re.IGNORECASE)
        same_line = clean_text(same_line)
        if same_line and not any(same_line.lower().startswith(s.lower()) for s in stop_labels):
            return same_line

        # --- Multi-line value: collect next lines until a stop label or blank ---
        value_lines = []
        for j in range(i + 1, len(lines)):
            next_line = lines[j]
            if any(re.match(r"^\s*" + re.escape(s) + r"\s*[:\-]?\s*", next_line, re.IGNORECASE) for s in stop_labels):
                break
            value_lines.append(next_line)
            if len(value_lines) >= 2:  # don't over-collect
                break

        if value_lines:
            combined = clean_text(' '.join(value_lines))
            # Avoid returning another label as the value
            if combined and not any(combined.lower().startswith(s.lower()) for s in stop_labels):
                return combined

    return None


def extract_sign_details(page_text: str) -> dict:
    """Extract explicit sign detail fields (vendor quote format)."""
    details = {}

    mapping = {
        "sign_type": ["sign type", "sign name", "product type", "description"],
        "dimensions": ["dimensions"],
        "color": ["color"],
        "finish": ["finish"],
        "illuminated": ["illuminated"],
        "usage": ["usage"],
        "ul_cert": ["ul certification", "ul certified"],
        "permit": ["permit"],
        "install": ["installation"],
    }

    for key, keywords in mapping.items():
        val = extract_labeled_value(page_text, keywords)
        if val:
            # --- Post-process known fields to remove Tesseract OCR noise ---
            if key == "illuminated":
                # Only accept Yes/No — strip noise like "No ae", "Yes :", "No Indoor" etc.
                val_clean = val.strip().split()[0]  # take first word only
                if val_clean.lower() in ("yes", "no"):
                    val = val_clean.capitalize()
                else:
                    continue  # skip garbage
            elif key == "usage":
                # Only accept Indoor/Outdoor — Tesseract often misreads as "8", "e", etc.
                val_lower = val.lower()
                if "indoor" in val_lower:
                    val = "Indoor"
                elif "outdoor" in val_lower:
                    val = "Outdoor"
                else:
                    continue  # skip garbage value
            details[key] = val

    return details


def extract_section_price(page_text: str) -> dict:
    """
    Extract price from a 'Discounted Price' or 'Price' section.
    Returns { original_price, discounted_price }.

    Examples:
      'Discounted Price\n1,440 USD\n1,296 USD' -> original=1440, discounted=1296
      'Price\n1,440 USD' -> original=1440, discounted=None
      'Discounted Price\n$1,296 USD' -> original=None, discounted=1296
    """
    result = {"original_price": None, "discounted_price": None}
    lines = [clean_text(ln) for ln in page_text.splitlines() if clean_text(ln)]

    # Find the Discounted Price or Price section
    section_start = None
    section_label = None
    for i, line in enumerate(lines):
        if re.search(r"^\s*Discounted\s*Price\s*$", line, re.IGNORECASE):
            section_start = i + 1
            section_label = "discounted"
            break
        elif re.search(r"^\s*Price\s*$", line, re.IGNORECASE) and not re.search(r"Discounted", line, re.IGNORECASE):
            section_start = i + 1
            section_label = "price"
            break
        elif re.search(r"Total\s*(?:Price|Cost)?\s*$", line, re.IGNORECASE):
            section_start = i + 1
            section_label = "price"
            break

    if section_start is None:
        return result

    # Collect the next lines that look like prices (stop at unrelated labels)
    section_lines = []
    for line in lines[section_start:]:
        if re.search(r"^(Discount\s*Code|Client|Size|Note|Package|Terms|Copyright|Sign\s*Type|Dimensions|Color|Finish)", line, re.IGNORECASE):
            break
        section_lines.append(line)

    if not section_lines:
        return result

    section_text = "\n".join(section_lines)
    prices = extract_prices_strict(section_text) or extract_price_candidates(section_text)

    # Filter out dimension-like numbers (e.g., 115.5)
    dim_numbers = set()
    for m in RE_DIMENSION.finditer(section_text):
        dim_numbers.add(m.group(1))
        dim_numbers.add(m.group(2))
    prices = [p for p in prices if str(p) not in dim_numbers and str(int(p)) not in dim_numbers]

    if not prices:
        return result

    if section_label == "discounted":
        # First price is usually original (crossed out), last is the discounted/final price
        if len(prices) >= 2:
            result["original_price"] = prices[0]
            result["discounted_price"] = prices[-1]
        else:
            result["discounted_price"] = prices[0]
    else:
        result["original_price"] = prices[0]

    return result


def extract_client_specified_size(page_text: str) -> str | None:
    """Extract size tier from 'Client-Specified Size' section."""
    match = re.search(r"Client\s*Specified\s*Size\s*[:\-]?\s*(\w+)", page_text, re.IGNORECASE | re.MULTILINE)
    if match:
        tier = match.group(1).strip()
        if tier.lower() in [t.lower() for t in SIZE_TIERS]:
            return tier

    # Also try a line right after a "Client-Specified Size" heading
    lines = [clean_text(ln) for ln in page_text.splitlines() if clean_text(ln)]
    for i, line in enumerate(lines):
        if re.search(r"Client\s*Specified\s*Size", line, re.IGNORECASE):
            if i + 1 < len(lines):
                tier = lines[i + 1]
                if tier.lower() in [t.lower() for t in SIZE_TIERS]:
                    return tier
    return None


def extract_discount_code(page_text: str) -> str | None:
    """Extract discount code like 'SM10SALE'. Corrects common Tesseract OCR digit/letter confusion."""
    match = re.search(r"Discount\s*Code\s*[:\-]?\s*(\S+)", page_text, re.IGNORECASE | re.MULTILINE)
    if match:
        code = match.group(1).strip()
        # Fix Tesseract OCR errors: 'IO' → '10', 'l' → '1', 'O' → '0' in uppercase codes
        # e.g. SMIOSALE → SM10SALE, SMlOSALE → SM10SALE
        code = re.sub(r'(?<=[A-Z])IO(?=[A-Z])', '10', code)  # IO between letters = 10
        code = re.sub(r'(?<=[A-Z])l(?=[A-Z0-9])', '1', code)  # lowercase l = 1
        return code
    return None

def extract_client_info(first_page_text: str) -> dict:
    """
    Pull client name and email from the first page of the PDF.

    Strategy:
    1. Email is grabbed by regex (high confidence).
    2. Client name: look for explicit labels (Attn:, Client:, etc.) or
       the name under "Quote Details" / "Client" headings.
       Falls back to 'Unknown Client'.
    """
    lines = [clean_text(ln) for ln in first_page_text.splitlines() if clean_text(ln)]

    email = extract_email(first_page_text)
    client_name = None

    # Try: explicit labels on the same or next line
    for i, line in enumerate(lines):
        # Same-line label: "Client: John" — require colon/dash after label word to avoid matching "Client-Specified Size"
        m = re.match(r"(?:Attn|Attention|Client(?!-)|To|Name|Dear|Prepared\s*For|Bill\s*To)\s*[:\-]\s*(.+)", line, re.IGNORECASE)
        if m:
            client_name = m.group(1).strip()
            break
        # Label on its own line, value on next line
        if re.match(r"(?:Attn|Attention|Client|To|Name|Prepared\s*For|Bill\s*To)\s*[:\-]?\s*$", line, re.IGNORECASE) and i + 1 < len(lines):
            candidate = lines[i + 1]
            if not re.search(r"(@|proposal|quote|invoice|date|luminus|sign|support|info)", candidate, re.IGNORECASE):
                client_name = candidate
                break

    # the "Quote Details" section: name is usually directly under it
    if not client_name:
        for i, line in enumerate(lines):
            if "quote details" in line.lower() and i + 1 < len(lines):
                possible_name = lines[i + 1]
                if not re.match(r"(sign type|dimensions|color|finish|email|phone|@)", possible_name, re.IGNORECASE):
                    client_name = possible_name
                    break

    # Fallback: if we found email, try the line immediately before it
    if not client_name and email:
        email_line_idx = next(
            (i for i, ln in enumerate(lines) if email in ln.lower()), None
        )
        if email_line_idx and email_line_idx > 0:
            candidate = lines[email_line_idx - 1]
            # Reject if it looks like an address / header / vendor email
            if not re.search(r"(proposal|quote|invoice|date|luminus|sign|support|info@|sales@|hello@)", candidate, re.IGNORECASE):
                client_name = candidate

    return {
        "client_name": client_name or "Unknown Client",
        "client_email": email or "",
    }


# ----------------------------------------------------------------
# ITEM-LEVEL EXTRACTION (Per Page)
# ----------------------------------------------------------------

def extract_item_from_page(page_num: int, page_text: str, page_tables: list) -> dict:
    """
    Extract sign item data from a single PDF page.

    Tries explicit vendor-specific labels first, then tables, then raw text.
    """
    item = {
        "page_number": page_num,
        "sign_type": None,
        "size": None,
        "original_price": None,
        "discounted_price": None,
        "pricing": [],
        "color": None,
        "finish": None,
        "illuminated": None,
        "usage": None,
        "ul_cert": None,
        "permit": None,
        "install": None,
        "discount_code": None,
        "extracted_images": [],
        "validation_flags": {},
    }

    # --- Explicit sign details (vendor quote format) ---
    details = extract_sign_details(page_text)
    item["sign_type"] = details.get("sign_type")
    item["size"] = details.get("dimensions") or extract_client_specified_size(page_text)
    item["color"] = details.get("color")
    item["finish"] = details.get("finish")
    item["illuminated"] = details.get("illuminated")
    item["usage"] = details.get("usage")
    item["ul_cert"] = details.get("ul_cert")
    item["permit"] = details.get("permit")
    item["install"] = details.get("install")
    item["discount_code"] = extract_discount_code(page_text)

    # --- Try structured table extraction ---
    if not item["sign_type"] or not item["size"]:
        for table in page_tables:
            for row in table:
                if not row:
                    continue
                row_text = " ".join(str(cell) for cell in row if cell)

                if not item["sign_type"]:
                    item["sign_type"] = extract_sign_type(row_text)

                if not item["size"]:
                    item["size"] = extract_dimension(row_text)
                    if not item["size"]:
                        item["size"] = extract_size_tier(row_text)

    # --- Fall back to raw text parsing ---
    if not item["sign_type"]:
        item["sign_type"] = extract_sign_type(page_text)

    if not item["size"]:
        item["size"] = extract_dimension(page_text) or extract_client_specified_size(page_text)

    # --- Extract full pricing table (size / dimension / price / discounted) ---
    item["pricing"] = extract_pricing_table(page_text, page_tables)

    if item["pricing"]:
        # Primary price = first cost in the table
        item["original_price"] = item["pricing"][0].get("cost")
        item["discounted_price"] = item["pricing"][0].get("discounted_cost")
        # Overall size = first dimension if main size is missing
        if not item["size"] and item["pricing"][0].get("dim"):
            item["size"] = item["pricing"][0]["dim"]
    else:
        # No structured pricing table — use explicit Discounted Price / Price section
        section_prices = extract_section_price(page_text)
        item["original_price"] = section_prices.get("original_price")
        item["discounted_price"] = section_prices.get("discounted_price")

        if item["original_price"] is None:
            # Last fallback: first strict price in the page that is not a dimension number
            strict_prices = extract_prices_strict(page_text)
            if strict_prices:
                item["original_price"] = strict_prices[0]
            else:
                prices = extract_price_candidates(page_text)
                dim_numbers = set()
                for m in RE_DIMENSION.finditer(page_text):
                    dim_numbers.add(m.group(1))
                    dim_numbers.add(m.group(2))
                for price in prices:
                    price_str = str(price) if price % 1 else str(int(price))
                    if price_str not in dim_numbers:
                        item["original_price"] = price
                        break

    # If only a discounted price exists, use it as the effective price
    if item["original_price"] is None and item["discounted_price"] is not None:
        item["original_price"] = item["discounted_price"]

    return item


# ----------------------------------------------------------------
# VALIDATION LAYER
# ----------------------------------------------------------------

# Dimension pattern: digits x digits (with optional unit, spaces allowed)
RE_VALID_DIM = re.compile(r"\d+(?:\.\d+)?\s*(?:in|ft|cm|mm|inches?|feet?)?\s*[xX×]\s*\d+(?:\.\d+)?\s*(?:in|ft|cm|mm|inches?|feet?)?")

def validate_item(item: dict) -> dict:
    """
    Run validation rules on an extracted item.
    Returns a validation_flags dict (empty = all good).
    """
    flags = {}

    # Price must be numeric and positive
    if item["original_price"] is None and not item.get("pricing"):
        flags["price_missing"] = True
    elif item["original_price"] is not None and item["original_price"] <= 0:
        flags["price_non_positive"] = True
    elif item["original_price"] is not None and item["original_price"] > 500_000:
        flags["price_suspiciously_high"] = True

    # Check pricing table rows
    if item.get("pricing"):
        for idx, row in enumerate(item["pricing"]):
            if row.get("cost") is None:
                flags[f"pricing_row_{idx}_price_missing"] = True
            if not row.get("dim"):
                flags[f"pricing_row_{idx}_dim_missing"] = True

    # Size must match dimension pattern or be a known tier
    if not item["size"]:
        flags["size_missing"] = True
    elif not RE_VALID_DIM.search(str(item["size"])) and item["size"] not in SIZE_TIERS:
        flags["size_unrecognized_format"] = True

    # Sign type must be set
    if not item["sign_type"]:
        flags["sign_type_missing"] = True

    return flags


def validate_client(client: dict) -> dict:
    """Run validation rules on client-level fields."""
    flags = {}

    if not client["client_email"]:
        flags["email_missing"] = True
    elif not RE_EMAIL.match(client["client_email"]):
        flags["email_invalid"] = True

    if not client["client_name"] or client["client_name"] == "Unknown Client":
        flags["name_missing"] = True

    return flags


# ----------------------------------------------------------------
# MAIN EXTRACTION ENTRYPOINT
# ----------------------------------------------------------------

def extract_pdf(pdf_path: str, skip_last_page: bool = False) -> dict:
    """
    Parse the entire PDF and return structured extraction result.

    Returns:
    {
      "client": { client_name, client_email, validation_flags, needs_manual_check },
      "items":  [ { page_number, sign_type, size, original_price, validation_flags, needs_manual_check }, ... ]
    }
    """
    path = Path(pdf_path)
    if not path.exists():
        return {"error": f"File not found: {pdf_path}"}

    result = {
        "source_pdf": str(path),
        "client": {},
        "items": [],
    }

    try:
        # Extract images by rendering the page using PyMuPDF (fitz)
        # This prevents the severe aspect ratio distortion caused by extracting
        # raw embedded image streams which rely on PDF matrix scaling.
        pdf_images_by_page = {}
        try:
            if fitz is not None:
                doc = fitz.open(pdf_path)
                for page_idx in range(len(doc)):
                    page_num = page_idx + 1
                    pdf_images_by_page[page_num] = []
                    
                    img_bytes = render_page_to_jpeg(pdf_path, page_idx, dpi=200)
                    if img_bytes:
                        img_filename = f"{path.stem}_p{page_num}_rendered.jpg"
                        img_path = path.parent / img_filename
                        with open(img_path, "wb") as f:
                            f.write(img_bytes)
                        pdf_images_by_page[page_num].append(str(img_path))
                doc.close()
            else:
                print("PyMuPDF not available for image extraction", file=sys.stderr)
        except Exception as img_exc:
            print(f"Failed to render pages as images: {img_exc}", file=sys.stderr)

        with pdfplumber.open(pdf_path) as pdf:
            if not pdf.pages:
                return {"error": "PDF has no pages"}

            pages_data = []
            gemini_queue = set()
            
            pages_to_process = pdf.pages
            if skip_last_page and len(pages_to_process) > 1:
                pages_to_process = pages_to_process[:-1]
            
            # PASS 1: Extract fast text and identify which pages need slow Gemini AI
            for page_idx, page in enumerate(pages_to_process):
                page_num = page_idx + 1
                page_text = page.extract_text() or ""
                page_tables = page.extract_tables() or []
                
                if not text_has_data(page_text):
                    pymupdf_text = pymupdf_page_text(pdf_path, page_idx)
                    if pymupdf_text:
                        page_text = pymupdf_text + "\n" + page_text

                # If still no text, render THIS specific page to a JPEG and OCR it.
                # IMPORTANT: We do NOT use pdf_images_by_page here — embedded images
                # are shared across pages in many PDFs, which causes both pages to return
                # identical OCR text. Rendering the page via PyMuPDF is page-specific.
                if not text_has_data(page_text) and pytesseract is not None and configure_tesseract():
                    rendered_bytes = render_page_to_jpeg(pdf_path, page_idx, dpi=200)
                    if rendered_bytes:
                        try:
                            import io as _io, tempfile
                            from PIL import Image as PILImage
                            img = PILImage.open(_io.BytesIO(rendered_bytes))
                            with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
                                img.save(tmp, format="JPEG")
                                tmp_path = tmp.name
                            ocr_text = pytesseract.image_to_string(tmp_path)
                            os.remove(tmp_path)
                            if ocr_text.strip():
                                print(f"OCR text (rendered page {page_num}): {ocr_text[:300].replace(chr(10), ' ')}...", file=sys.stderr)
                                page_text = ocr_text + "\n" + page_text
                        except Exception as ocr_exc:
                            print(f"Page render OCR error (page {page_num}): {ocr_exc}", file=sys.stderr)

                # SMART GEMINI ROUTING: only call Gemini if text extraction has gaps.
                # Pre-extract the item to check for missing/invalid fields.
                # This avoids burning Gemini API credits when pdfplumber already got everything.
                if os.environ.get("VITE_GEMINI_API_KEY"):
                    pre_item = extract_item_from_page(page_num, page_text, page_tables)
                    pre_flags = validate_item(pre_item)
                    # Always run Gemini on page 1 (for client name/email).
                    # Also run if any fields are flagged missing or unrecognized.
                    needs_ai = (page_idx == 0) or bool(pre_flags)
                    if needs_ai:
                        reason = "page 1 (client info)" if page_idx == 0 else f"flags: {list(pre_flags.keys())}"
                        print(f"  → Queuing page {page_num} for Gemini ({reason})", file=sys.stderr)
                        gemini_queue.add(page_idx)
                    else:
                        print(f"  ✓ Page {page_num}: text extraction complete, skipping Gemini", file=sys.stderr)

                pages_data.append({
                    "page_num": page_num,
                    "page_idx": page_idx,
                    "page_text": page_text,
                    "page_tables": page_tables
                })
                
            # PASS 2: Execute all required Gemini AI calls concurrently (multi-threading)
            gemini_results = {}
            if gemini_queue:
                with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                    future_to_idx = {executor.submit(extract_page_with_ai_fallback, pdf_path, idx): idx for idx in gemini_queue}
                    for future in concurrent.futures.as_completed(future_to_idx):
                        idx = future_to_idx[future]
                        try:
                            gemini_results[idx] = future.result()
                        except Exception as e:
                            print(f"Gemini error on page {idx+1}: {e}", file=sys.stderr)
                            gemini_results[idx] = None
                            
            # Process Page 1 for client info
            first_page_data = pages_data[0]
            first_text = first_page_data["page_text"]
            gemini_page_1 = gemini_results.get(0)
            
            if gemini_page_1:
                first_text = json.dumps(gemini_page_1) + "\n" + first_text
                
            client = extract_client_info(first_text)
            
            if gemini_page_1 and client["client_name"] == "Unknown Client" and gemini_page_1.get("client_name"):
                client["client_name"] = str(gemini_page_1["client_name"]).strip()
            if gemini_page_1 and not client["client_email"] and gemini_page_1.get("client_email"):
                client["client_email"] = str(gemini_page_1["client_email"]).strip()

            client_flags = validate_client(client)
            client["validation_flags"] = client_flags
            client["needs_manual_check"] = bool(client_flags)
            result["client"] = client

            # Process all pages for items
            for p_data in pages_data:
                page_num = p_data["page_num"]
                page_idx = p_data["page_idx"]
                page_text = p_data["page_text"]
                page_tables = p_data["page_tables"]
                gemini_data = gemini_results.get(page_idx)
                
                # DEBUG LOG — only written when EXTRACTOR_DEBUG=true is set in environment
                if os.environ.get("EXTRACTOR_DEBUG", "").lower() == "true":
                    with open("debug-extractor.log", "a", encoding="utf-8") as f:
                        f.write(f"--- PAGE {page_num} TEXT ---\n")
                        f.write(page_text + "\n")
                    
                item = extract_item_from_page(page_num, page_text, page_tables)
                
                if gemini_data:
                    item = merge_gemini_into_item(item, gemini_data)
                    
                if page_num in pdf_images_by_page:
                    item["extracted_images"] = pdf_images_by_page[page_num]

                item_flags = validate_item(item)
                item["validation_flags"] = item_flags
                item["needs_manual_check"] = bool(item_flags)
                result["items"].append(item)

    except Exception as exc:
        return {"error": f"Extraction failed: {exc}"}

    return result


# ----------------------------------------------------------------
# CLI ENTRY
# ----------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract proposal data from a PDF")
    parser.add_argument("pdf_path", help="Path to the PDF file")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output")
    parser.add_argument("--skip-last-page", action="store_true", help="Skip the last page of the PDF")
    args = parser.parse_args()

    output = extract_pdf(args.pdf_path, skip_last_page=args.skip_last_page)

    if args.pretty:
        print(json.dumps(output, indent=2))
    else:
        print(json.dumps(output))

    # Exit with error code if critical extraction failed
    if "error" in output:
        sys.exit(1)
    if output.get("client", {}).get("needs_manual_check"):
        sys.exit(2)   # Soft error — caller knows to flag for review
