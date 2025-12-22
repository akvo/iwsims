from os import environ, path
from util.util import Cipher


class Dev:
    def __init__(self):
        self.status = "DEV" in environ

    def get_cached(self, file):
        if not self.status:
            return False
        if not path.exists(file):
            return False
        return file

    def generate(self, alias: str, fid: int):
        return Cipher(f"{alias}-{fid}").encode()
