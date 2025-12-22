import os
import xmltodict
import functools
import json
from lxml import etree

keys = os.environ["CIPHER_KEYS"]
chars = os.environ["CIPHER_CHARS"]
an = len(chars)


def readxml(xml_path: str, alias: str):
    with open(xml_path) as survey:
        encoding = etree.parse(survey)
        encoding = encoding.docinfo.encoding
    with open(xml_path) as survey:
        survey = xmltodict.parse(
            survey.read(),
            encoding=encoding,
            attr_prefix='',
            cdata_key='text',
            force_list={
                'questionGroup', 'question', 'option',
                'level', 'altText', 'dependency'
            }
        )
        survey = json.dumps(survey) \
            .replace('"true"', 'true') \
            .replace('"false"', 'false') \
            .replace('"answer-value"', '"answerValue"')
        survey = json.loads(survey)
        response = survey['survey']
        response.update({"alias": alias})
    return response


class Cipher():
    def __init__(self, str_param):
        self.str_param = str_param

    def encode(self):
        n = self.str_param.split("-")[-1]
        n = functools.reduce(lambda a, b: int(a) + int(b), list(str(n)))
        n = str(n)[-1]
        nab = "".join([
            chars[-i if i + int(n) > an else int(n) + i - an]
            for i, a in enumerate(chars)
        ])
        ad = "".join(
            [keys[nab.find(a)] if a in nab else a for a in self.str_param])
        return f"{ad}{n}"

    def decode(self):
        n = int(self.str_param[-1])
        nab = "".join([
            chars[-i if i + int(n) > an else int(n) + i - an]
            for i, a in enumerate(chars)
        ])
        try:
            ad = "".join([
                nab[keys.find(a)] if a in keys else a
                for a in self.str_param[:-1]
            ])
            ad = ad.split("-")
            return "-".join(ad[:-1]), int(ad[-1])
        except IndexError:
            pass
        return None, None
