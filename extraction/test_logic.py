"""Quick test for extraction logic without a real PDF."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from extractor import (
    extract_client_info,
    extract_sign_details,
    extract_section_price,
    extract_item_from_page,
    extract_labeled_value,
)

sample_text = """
Quote Details

John Schaeffer

SIGN TYPE
Acrylic Panel Sign

DIMENSIONS
115.5 in x 23.2 in

COLOR
Same as Mockup

FINISH
Matte

ILLUMINATED
No

USAGE
Outdoor

UL CERTIFICATION
No

PERMIT
On Demand

INSTALLATION
On Demand

Client-Specified Size
Large

Discounted Price
1,440 USD
1,296 USD

Discount Code
SM10SALE

info@example.com
""".strip()

print("=== Client Info ===")
client = extract_client_info(sample_text)
print(client)

print("\n=== Sign Details ===")
details = extract_sign_details(sample_text)
print(details)

print("\n=== Section Price ===")
prices = extract_section_price(sample_text)
print(prices)

print("\n=== Item Extraction ===")
item = extract_item_from_page(1, sample_text, [])
print({
    "sign_type": item["sign_type"],
    "size": item["size"],
    "original_price": item["original_price"],
    "discounted_price": item["discounted_price"],
    "discount_code": item["discount_code"],
    "color": item["color"],
    "finish": item["finish"],
    "illuminated": item["illuminated"],
    "usage": item["usage"],
    "ul_cert": item["ul_cert"],
    "permit": item["permit"],
    "install": item["install"],
    "validation_flags": item["validation_flags"],
})
