import uuid

from django.core.management import BaseCommand
from django.utils import timezone
from django_q.tasks import async_task

from api.v1.v1_forms.models import Forms
from api.v1.v1_jobs.constants import JobTypes, JobStatus, DataDownloadTypes
from api.v1.v1_jobs.models import Jobs


class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument("form", nargs="+", type=int)
        parser.add_argument("user", nargs="+", type=int)
        parser.add_argument(
            "-a", "--administration", nargs="?", default=0, type=int
        )
        parser.add_argument(
            "-t",
            "--type",
            nargs="?",
            default=DataDownloadTypes.recent,
            type=str,
        )
        parser.add_argument(
            "-l", "--use_label", nargs="?", default=1, type=int
        )
        parser.add_argument(
            "-c", "--child_form_ids", nargs="*", default=[], type=int
        )
        parser.add_argument(
            "-s", "--selection_ids", nargs="*", default=[], type=int
        )
        parser.add_argument(
            "-df", "--date_from", nargs="?", default=None, type=str
        )
        parser.add_argument(
            "-dt", "--date_to", nargs="?", default=None, type=str
        )

    def handle(self, *args, **options):
        administration = options.get("administration")
        use_label = options.get("use_label", 1)
        download_type = options.get("type", DataDownloadTypes.recent)
        if download_type not in [
            DataDownloadTypes.all,
            DataDownloadTypes.recent,
        ]:
            download_type = DataDownloadTypes.recent
        form_id = options.get("form")[0]
        form = Forms.objects.get(pk=form_id)
        # validate form should have parent is null
        if form.parent is not None:
            self.stdout.write(
                self.style.ERROR(
                    "Form id {0} is not a registration form".format(form.id)
                )
            )
            return

        child_form_ids = options.get("child_form_ids", [])
        # validate child_form_ids is a child of form
        if len(child_form_ids):
            valid_child_form_ids = form.children.values_list("id", flat=True)
            for child_form_id in child_form_ids:
                if child_form_id not in valid_child_form_ids:
                    self.stdout.write(
                        self.style.ERROR(
                            "{0} is not a child of form id {1}".format(
                                child_form_id, form.id
                            )
                        )
                    )
                    return
        selection_ids = options.get("selection_ids", [])
        date_from = options.get("date_from")
        date_to = options.get("date_to")
        info = {
            "form_id": form_id,
            "administration": administration if administration > 0 else None,
            "download_type": download_type,
            "use_label": use_label == 1,
            "child_form_ids": child_form_ids,
            "selection_ids": selection_ids,
            "date_from": date_from,
            "date_to": date_to,
        }
        form_name = form.name.replace(" ", "_").lower()
        today = timezone.datetime.today().strftime("%y%m%d")
        ext = "zip" if child_form_ids else "xlsx"
        out_file = "download-{0}-{1}-{2}.{3}".format(
            form_name, today, uuid.uuid4(), ext
        )
        job = Jobs.objects.create(
            type=JobTypes.download,
            user_id=options.get("user")[0],
            status=JobStatus.on_progress,
            info=info,
            result=out_file,
        )
        task_id = async_task(
            "api.v1.v1_jobs.job.job_generate_data_download",
            job.id,
            **info,
            hook="api.v1.v1_jobs.job.job_generate_data_download_result"
        )
        job.task_id = task_id
        job.save()
        return str(job.id)
