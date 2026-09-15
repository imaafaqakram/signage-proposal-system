import io
import torch
from PIL import Image
from flask import Flask, request, jsonify
from transformers import AutoProcessor, AutoModelForCausalLM

app = Flask(__name__)

# 1. Dynamic Hardware Detection
device = "cuda" if torch.cuda.is_available() else "cpu"
# Use float16 for GPU to save VRAM and speed up inference. CPU requires float32.
torch_dtype = torch.float16 if torch.cuda.is_available() else torch.float32

print(f"Loading Florence-2 on {device.upper()} using {torch_dtype}...")

# Bypass transformers aggressive AST import checker for flash_attn
from unittest.mock import patch
from transformers.dynamic_module_utils import get_imports
def mock_get_imports(filename: str):
    imports = get_imports(filename)
    return [i for i in imports if i != "flash_attn"]

with patch("transformers.dynamic_module_utils.get_imports", mock_get_imports):
    model_id = 'microsoft/Florence-2-base'
    processor = AutoProcessor.from_pretrained(model_id, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        model_id, 
        torch_dtype=torch_dtype, 
        trust_remote_code=True
    ).to(device).eval()

@app.route('/extract', methods=['POST'])
def extract_data():
    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400
        
    file = request.files['file']
    image = Image.open(io.BytesIO(file.read())).convert("RGB")
    
    task_prompt = '<OCR_WITH_REGION>'
    
    # Ensure inputs are sent to the correct active device
    inputs = processor(text=task_prompt, images=image, return_tensors="pt")
    inputs = {k: v.to(device) if isinstance(v, torch.Tensor) else v for k, v in inputs.items()}
    
    # Only cast pixel_values to the specific dtype
    inputs["pixel_values"] = inputs["pixel_values"].to(torch_dtype)
    
    with torch.no_grad():
        generated_ids = model.generate(
            input_ids=inputs["input_ids"],
            pixel_values=inputs["pixel_values"],
            max_new_tokens=1024,
            do_sample=False,
            num_beams=3,
        )
    
    generated_text = processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
    
    parsed_answer = processor.post_process_generation(
        generated_text, task=task_prompt, image_size=(image.width, image.height)
    )
    
    return jsonify({"extracted_data": parsed_answer})

if __name__ == '__main__':
    # Run production server on port 5000
    app.run(host='0.0.0.0', port=5000)
