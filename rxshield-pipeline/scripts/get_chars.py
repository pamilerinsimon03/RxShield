import torch

class CharacterMapper:
    def __init__(self):
        pass
    def __setstate__(self, state):
        self.__dict__.update(state)

checkpoint = torch.load('best_model.pth', map_location='cpu', weights_only=False)
char_mapper = checkpoint.get("char_mapper")
print(f"CHARS_LEN: {len(char_mapper.chars)}")
print(f"CHARS: {list(char_mapper.chars)}")
print(f"DICT: {char_mapper.__dict__}")
print(f"DIR: {dir(char_mapper)}")
