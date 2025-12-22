from typing import Optional
from pydantic import BaseModel, Field, create_model
import inspect


def optional(*fields):
    def dec(_cls):
        # Create new field definitions with optional types
        new_fields = {}
        for field_name, field in _cls.model_fields.items():
            if field_name in fields:
                # Make the field optional by wrapping its type in Optional
                field_type = field.annotation
                new_fields[field_name] = (
                    Optional[field_type],
                    Field(default=None),
                )
            else:
                # Keep other fields as they are
                new_fields[field_name] = (field.annotation, field.default)

        # Create a new model with the updated field definitions
        return create_model(_cls.__name__, __base__=_cls, **new_fields)

    if (
        fields
        and inspect.isclass(fields[0])
        and issubclass(fields[0], BaseModel)
    ):
        cls = fields[0]
        fields = cls.model_fields.keys()
        return dec(cls)
    return dec
