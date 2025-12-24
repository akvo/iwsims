import pandas as pd

instances = pd.read_csv('./data/flow-survey-amazon-aws.csv')


def xml_survey(instance: str):
    instance = instances[instances['instances'] == instance]
    if instance.shape[0]:
        endpoint = list(instance['bucket'])[0]
        return 'https://{}.s3.amazonaws.com/surveys'.format(endpoint)
    return None
