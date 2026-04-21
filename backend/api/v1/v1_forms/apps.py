from django.apps import AppConfig


class V1FormsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'api.v1.v1_forms'

    def ready(self):
        from api.v1.v1_forms.signals import register
        register()
