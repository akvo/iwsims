class GridSize:
    W_25 = "6"
    W_50 = "12"
    W_75 = "18"
    W_100 = "24"

    FieldStr = {
        W_25: "25% width (6/24)",
        W_50: "50% width (12/24)",
        W_75: "75% width (18/24)",
        W_100: "100% width (24/24)",
    }

    @classmethod
    def choices(cls):
        return [(k, v) for k, v in cls.FieldStr.items()]
