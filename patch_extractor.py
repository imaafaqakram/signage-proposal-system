import sys, os

with open('extraction/extractor.py', 'r', encoding='utf-8') as f:
    content = f.read()

start = content.find('def extract_page_with_ai_fallback')
end = content.find('def merge_gemini_into_item')

new_func = """def extract_page_with_ai_fallback(pdf_path: str, page_idx: int) -> dict:
    \"\"\"
    Tries Florence-2 -> Gemini Text -> Gemini Vision -> Replicate Vision
    \"\"\"
    import os, json, sys, requests
    img_bytes = render_page_to_jpeg(pdf_path, page_idx)
    if not img_bytes:
        return {}
        
    schema_prompt = \"\"\"Return ONLY a valid JSON object matching this schema:
{
  "client_name": "string (or null)",
  "client_email": "string (or null)",
  "sign_type": "string (e.g. 3D Metal Back-lit)",
  "size": "string (e.g. 24in x 24in or Large)",
  "dimensions": "string (or null)",
  "color": "string (or null)",
  "finish": "string (or null)",
  "illuminated": "string (or null)",
  "usage": "string (or null)",
  "ul_cert": "string (or null)",
  "permit": "string (or null)",
  "install": "string (or null)",
  "original_price": number (or null),
  "discounted_price": number (or null),
  "discount_code": "string (or null)",
  "pricing": [
    {"size": "string", "dim": "string", "cost": number, "discounted_cost": number}
  ]
}
If a field is not present, use null.\"\"\"

    # 1. Florence-2 Pipeline
    florence_url = os.environ.get("FLORENCE_API_URL")
    gemini_key = os.environ.get("VITE_GEMINI_API_KEY")
    
    if florence_url and gemini_key:
        print(f"Trying Florence-2 OCR on page {page_idx + 1}...", file=sys.stderr)
        try:
            files = {'file': ('image.jpg', img_bytes, 'image/jpeg')}
            resp = requests.post(florence_url, files=files, timeout=30)
            resp.raise_for_status()
            ocr_result = resp.json().get("extracted_data", "")
            
            if ocr_result:
                print("✅ Florence OCR complete. Structuring with Gemini Text...", file=sys.stderr)
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
                    model_name="gemini-1.5-flash",
                    generation_config={"temperature": 0.0, "response_mime_type": "application/json"},
                    safety_settings=safety_settings
                )
                
                prompt = f"You are a precise data extraction tool. Parse this OCR text and {schema_prompt}\\n\\nOCR Text:\\n{ocr_result}"
                response = model.generate_content(prompt)
                if response.text:
                    res = json.loads(response.text)
                    print("✅ Florence -> Gemini Text extraction complete", file=sys.stderr)
                    return res
        except Exception as e:
            print(f"Florence pipeline failed: {e}. Falling back to Vision models...", file=sys.stderr)

    # 2. Gemini Vision Fallback
    if gemini_key:
        print(f"Trying Gemini Vision on page {page_idx + 1}...", file=sys.stderr)
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
            
            prompt = f"You are a precise data extraction tool. Extract the proposal data from this image and {schema_prompt}"
            img_part = {"mime_type": "image/jpeg", "data": img_bytes}
            response = model.generate_content([prompt, img_part])
            
            if response.text:
                res = json.loads(response.text)
                print("✅ Gemini Vision extraction complete", file=sys.stderr)
                return res
        except Exception as e:
            print(f"Gemini Vision failed: {e}. Falling back to Replicate...", file=sys.stderr)
            
    # 3. Replicate LLaMA Vision Fallback
    replicate_key = os.environ.get("VITE_REPLICATE_API_TOKEN")
    if replicate_key:
        print(f"Trying Replicate LLaMA 3.2 Vision on page {page_idx + 1}...", file=sys.stderr)
        try:
            import replicate
            import base64
            
            os.environ["REPLICATE_API_TOKEN"] = replicate_key
            b64_image = base64.b64encode(img_bytes).decode('utf-8')
            data_uri = f"data:image/jpeg;base64,{b64_image}"
            
            prompt = f"You are a precise data extraction tool. Extract the proposal data from this image and {schema_prompt}\\nIMPORTANT: Only output the raw JSON object, no markdown blocks or extra text."
            
            output = replicate.run(
                "lucataco/ollama-llama3.2-vision-90b:54202b223d5351c5afe5c0c9dba2b3042293b839d022e76f53d66ab30b9dc814",
                input={
                    "image": data_uri,
                    "prompt": prompt,
                    "max_tokens": 1024,
                    "temperature": 0.1
                }
            )
            
            full_text = "".join(list(output)).strip()
            if full_text.startswith("```json"): full_text = full_text[7:]
            if full_text.startswith("```"): full_text = full_text[3:]
            if full_text.endswith("```"): full_text = full_text[:-3]
                
            res = json.loads(full_text.strip())
            print("✅ Replicate extraction complete", file=sys.stderr)
            return res
        except Exception as e:
            print(f"Replicate failed: {e}", file=sys.stderr)
            
    return {}

"""

content = content[:start] + new_func + content[end:]
with open('extraction/extractor.py', 'w', encoding='utf-8') as f:
    f.write(content)
print("extractor patched")
