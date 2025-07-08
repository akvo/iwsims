from django.db import models
from api.v1.v1_forms.models import Questions
from api.v1.v1_users.models import SystemUser
from api.v1.v1_visualization.constants import GridSize


class Dashboard(models.Model):
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        SystemUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_dashboards",
    )
    published = models.BooleanField(default=False)

    def __str__(self):
        return self.title


class DashboardItem(models.Model):
    dashboard = models.ForeignKey(
        Dashboard, related_name="items", on_delete=models.CASCADE
    )

    title = models.CharField(max_length=255)
    grid_size = models.CharField(
        max_length=2, choices=GridSize.choices(), default=GridSize.W_100
    )
    visualization_type = models.CharField(max_length=50)

    chart_type = models.CharField(max_length=50, blank=True, null=True)

    x_axis = models.ForeignKey(
        Questions,
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="x_axis_items",
    )
    y_axis = models.ForeignKey(
        Questions,
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="y_axis_items",
    )
    number_column = models.ForeignKey(
        Questions,
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="number_column_items",
    )
    distict_column = models.ForeignKey(
        Questions,
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="distinct_column_items",
    )
    pie_value = models.ForeignKey(
        Questions,
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="pie_value_items",
    )
    pie_group = models.ForeignKey(
        Questions,
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="pie_group_items",
    )

    created_by = models.ForeignKey(
        SystemUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_dashboard_items",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    published = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.dashboard.title} - {self.title}"
